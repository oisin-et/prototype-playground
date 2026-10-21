// The prototype-playground kit: what a playground version is (playground/README.md).
//
// Its own file, imported by the versions, the registry and playground.dart,
// so none of them import each other in a circle: the web compiler bundles a
// circle of imports into one module, and when a new version joined it, a
// fresh page load got the old registry.

import 'package:flutter/widgets.dart';

/// Draws one page in a version.
///
/// [below] is what the page would be without this version: the app's own
/// page, or the page another running version made (two picked versions can
/// change the same page; the later one in index.json gets the earlier one's
/// here). Wrap it to change the page a little and keep the other version's
/// change. [app] is always the app's own page widget, so a version that
/// draws its own copy of the page can read the constructor arguments from it.
typedef PlaygroundPage = Widget Function(BuildContext context, Widget below, Widget app);

/// What one version changes: page id (as in <data>/screens.json) → its builder.
class PlaygroundVersion {
  const PlaygroundVersion(this.pages);
  final Map<String, PlaygroundPage> pages;
}
