// {title}: {name} ({id}). See versions.json for what it changes.
//
// Keep `version` a getter: a hot reload then picks up changes to it.

import 'package:{package}/playground/version_api.dart';
import 'package:{package}/{orig_path}' as orig;

import '{copy}' as page;

PlaygroundVersion get version => PlaygroundVersion({{
  // A copy of the whole screen, built from the app's own screen's arguments.
  // It replaces `below`; to change the screen a little instead, wrap `below`.
  '{screen}': (context, below, app) {{
    final o = app as orig.{type};
    return page.{build};
  }},
}});
