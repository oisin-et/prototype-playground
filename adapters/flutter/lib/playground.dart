// The prototype-playground kit: the playground's runtime (playground/README.md).
//
// The playground page (playground/index.html, served by playground/serve.py)
// runs this app in a frame between its two panels. It decides which version
// of each page runs and tells the app over postMessage; this file only does
// what it's told:
//
//   host → app  {type: 'layers', layers: ['settings/compact/v1', …]}
//               the versions to run, in <data>/index.json order
//               {type: 'show', screen: 'settings'} open that page
//               {type: 'capture', id, rect, scale} draw part of the app
//               {type: 'inspect', id, x, y}        the widget at a point, for a note
//   app → host  {type: 'hello', versions: {id: [screens]}}
//               the versions compiled in (registry.g.dart), sent at start
//               and after every hot reload
//               {type: 'where', screen, params}     the page on show
//               {type: 'captured', id, png, note}   a capture's PNG (base64)
//               {type: 'inspected', id, box, widget, location, text}
//               the project's innermost widget at that point (or just id)
//
// A version is Dart: lib/playground/<screen>/<exploration>/<version>/
// version.dart defines `PlaygroundVersion get version` (lib/playground/version_api.dart), which maps each page
// it changes to a builder. The builder gets the page under it (the app's
// own, or another running version's) and the app's own page widget, so a
// version can wrap the one, or draw its own copy from the other's arguments.
//
// Outside the playground frame (the desktop app, or the web preview opened
// on its own) none of this runs: [Playground.page] returns the original.

import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import 'bridge_stub.dart' if (dart.library.js_interop) 'bridge_web.dart' as bridge;
import 'registry.g.dart';

export 'version_api.dart';

class Playground extends ChangeNotifier {
  Playground._();
  static final Playground instance = Playground._();

  /// Whether the app runs inside the playground page.
  bool get embedded => bridge.embedded;

  List<String> _layers = const [];
  void Function(String screen)? _show;
  Map<String, Object?> Function()? _where;
  final GlobalKey _root = GlobalKey();

  /// Called once by the app shell. [show] opens a page by id; [where] says
  /// which page is on show, as {screen, params}.
  void attach({
    required void Function(String screen) show,
    required Map<String, Object?> Function() where,
  }) {
    if (!embedded) return;
    _show = show;
    _where = where;
    bridge.listen(_onMessage);
    hello();
  }

  /// The versions compiled in, for the host. Sent again after a hot reload
  /// ([PlaygroundRoot.reassemble]), which is how a new version shows up.
  void hello() {
    if (!embedded) return;
    final versions = playgroundVersions();
    bridge.post(jsonEncode({
      'type': 'hello',
      'versions': {for (final e in versions.entries) e.key: e.value.pages.keys.toList()},
    }));
    report();
  }

  /// Tells the host which page is on show. The shell calls it on every
  /// navigation.
  void report() {
    if (!embedded || _where == null) return;
    bridge.post(jsonEncode({'type': 'where', ..._where!()}));
  }

  /// [original], with every running version that changes [screen] laid over
  /// it, in <data>/index.json order.
  Widget page(BuildContext context, String screen, Widget original) {
    if (!embedded || _layers.isEmpty) return original;
    final versions = playgroundVersions();
    var out = original;
    for (final id in _layers) {
      final build = versions[id]?.pages[screen];
      if (build != null) out = build(context, out, original);
    }
    return out;
  }

  /// Wraps the app, so a capture can draw it.
  Widget wrapRoot(Widget child) =>
      embedded ? PlaygroundRoot(boundaryKey: _root, child: child) : child;

  void _onMessage(String data) {
    final Object? m;
    try {
      m = jsonDecode(data);
    } on FormatException {
      return;
    }
    if (m is! Map) return;
    switch (m['type']) {
      case 'layers':
        final next = [for (final x in (m['layers'] as List? ?? const [])) '$x'];
        if (!listEquals(next, _layers)) {
          _layers = next;
          notifyListeners();
        }
        // After the rebuild, so a version that changes the page on show
        // reports it again.
        WidgetsBinding.instance.addPostFrameCallback((_) => report());
      case 'show':
        _show?.call('${m['screen']}');
      case 'capture':
        _capture(m);
      case 'inspect':
        _inspect(m);
    }
  }

  // ---- Capture ---------------------------------------------------------------
  // The host asks for part of the app, in the frame's CSS pixels (which are
  // Flutter's logical pixels). The app draws itself at [scale] and cuts the
  // area out, and names the project's own widgets inside it, with the file
  // and line that built each one, so Claude knows where to look.
  Future<void> _capture(Map m) async {
    final id = m['id'];
    try {
      final r = m['rect'] as Map;
      final rect = Rect.fromLTWH(
        (r['x'] as num).toDouble(), (r['y'] as num).toDouble(),
        (r['w'] as num).toDouble(), (r['h'] as num).toDouble(),
      );
      final scale = (m['scale'] as num?)?.toDouble() ?? 2;
      final boundary = _root.currentContext?.findRenderObject() as RenderRepaintBoundary?;
      if (boundary == null) throw StateError('nothing to capture');
      final whole = await boundary.toImage(pixelRatio: scale);
      final recorder = ui.PictureRecorder();
      final out = Size((rect.width * scale).roundToDouble(), (rect.height * scale).roundToDouble());
      Canvas(recorder).drawImageRect(
        whole,
        Rect.fromLTWH(rect.left * scale, rect.top * scale, rect.width * scale, rect.height * scale),
        Offset.zero & out,
        Paint()..filterQuality = FilterQuality.medium,
      );
      final cut = await recorder.endRecording().toImage(out.width.toInt(), out.height.toInt());
      final png = await cut.toByteData(format: ui.ImageByteFormat.png);
      whole.dispose();
      cut.dispose();
      bridge.post(jsonEncode({
        'type': 'captured', 'id': id,
        'png': base64Encode(png!.buffer.asUint8List()),
        'note': _coverage(rect),
      }));
    } catch (e) {
      bridge.post(jsonEncode({'type': 'captured', 'id': id, 'error': '$e'}));
    }
  }

  // ---- Notes -----------------------------------------------------------------
  // The host asks which of the project's widgets is at a point (in the frame's
  // CSS pixels), to outline it and pin a note to it: the innermost one (the
  // last found, so the page on top wins), with its box, the file and line that
  // built it, and its text.
  void _inspect(Map m) {
    final id = m['id'];
    final at = Offset((m['x'] as num).toDouble(), (m['y'] as num).toDouble());
    final root = _root.currentContext as Element?;
    _Hit? hit;
    void visit(Element e) {
      final ro = e.renderObject;
      if (ro is RenderBox && ro.attached && ro.hasSize) {
        final box = MatrixUtils.transformRect(ro.getTransformTo(null), Offset.zero & ro.size);
        if (!box.contains(at)) return;
        if (e.widget is! RenderObjectWidget && !box.isEmpty) {
          final loc = _location(e);
          if (loc != null) hit = _Hit(e, loc, box);
        }
      }
      e.visitChildren(visit);
    }
    if (root != null) visit(root);
    final h = hit;
    bridge.post(jsonEncode({
      'type': 'inspected', 'id': id,
      if (h != null) ...{
        'box': [h.box.left, h.box.top, h.box.width, h.box.height],
        'widget': '${h.element.widget.runtimeType}',
        'location': h.location,
        'text': _text(h.element),
      },
    }));
  }

  /// The project's widgets inside [area] (the outermost ones, with their
  /// file, line and text), or else the smallest one around it.
  String _coverage(Rect area) {
    final root = _root.currentContext as Element?;
    if (root == null) return '';
    final inside = <_Hit>[];
    _Hit? around;
    void visit(Element e, bool underHit) {
      var hit = underHit;
      final ro = e.renderObject;
      final loc = _location(e);
      if (loc != null && ro is RenderBox && ro.attached && ro.hasSize && e.widget is! RenderObjectWidget) {
        final box = MatrixUtils.transformRect(ro.getTransformTo(null), Offset.zero & ro.size);
        if (!underHit && area.inflate(2).contains(box.topLeft) && area.inflate(2).contains(box.bottomRight) && !box.isEmpty) {
          inside.add(_Hit(e, loc, box));
          hit = true;
        } else if (box.contains(area.topLeft) && box.contains(area.bottomRight)) {
          around = _Hit(e, loc, box);
        }
      }
      e.visitChildren((c) => visit(c, hit));
    }
    visit(root, false);
    String name(_Hit h) {
      final text = _text(h.element);
      return '${h.element.widget.runtimeType} (${h.location}${text.isEmpty ? '' : ', "$text"'})';
    }
    final r = [area.left, area.top, area.width, area.height].map((v) => v.round()).toList();
    final list = inside.isNotEmpty
        ? 'It covers ${inside.take(20).map(name).join('; ')}${inside.length > 20 ? '; and ${inside.length - 20} more' : ''}.'
        : around != null ? "It's inside ${name(around!)}." : '';
    return 'The area at x ${r[0]}, y ${r[1]}, ${r[2]} × ${r[3]} of the app, in its logical pixels. $list'.trim();
  }

  /// Where the project's own code built [e]'s widget, as lib/…:line, or null
  /// for the framework's and packages' widgets. Debug builds only (flutter
  /// run tracks where widgets are made).
  static String? _location(Element e) {
    if (!kDebugMode) return null;
    final Object? at = InspectorSerializationDelegate(service: WidgetInspectorService.instance)
        .additionalNodeProperties(e.toDiagnosticsNode())['creationLocation'];
    if (at is! Map) return null;
    final file = '${at['file']}';
    final i = file.lastIndexOf('/lib/');
    if (i < 0 || file.contains('/packages/flutter/') || file.contains('.pub-cache') || file.contains('/third_party/')) return null;
    return '${file.substring(i + 1)}:${at['line']}';
  }

  static String _text(Element e) {
    final parts = <String>[];
    void visit(Element x) {
      final ro = x.renderObject;
      if (x.widget is RichText && ro is RenderParagraph) parts.add(ro.text.toPlainText());
      if (parts.length < 6) x.visitChildren(visit);
    }
    visit(e);
    final t = parts.join(' ').replaceAll(RegExp(r'\s+'), ' ').trim();
    return t.length > 40 ? '${t.substring(0, 40)}…' : t;
  }
}

class _Hit {
  _Hit(this.element, this.location, this.box);
  final Element element;
  final String location;
  final Rect box;
}

/// The app under a repaint boundary (for captures). A hot reload calls
/// [reassemble], which sends the host the versions compiled in now.
class PlaygroundRoot extends StatefulWidget {
  const PlaygroundRoot({super.key, required this.boundaryKey, required this.child});
  final GlobalKey boundaryKey;
  final Widget child;

  @override
  State<PlaygroundRoot> createState() => _PlaygroundRootState();
}

class _PlaygroundRootState extends State<PlaygroundRoot> {
  @override
  void reassemble() {
    super.reassemble();
    WidgetsBinding.instance.addPostFrameCallback((_) => Playground.instance.hello());
  }

  @override
  Widget build(BuildContext context) =>
      RepaintBoundary(key: widget.boundaryKey, child: widget.child);
}
