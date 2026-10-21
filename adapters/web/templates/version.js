// {title}: {name} ({id}). See versions.json for what it changes.
//
// React: a builder returns an element. ctx.below is the screen under this
// version, ctx.app the app's own screen element (its props in ctx.app.props).

import {{ createElement }} from 'react';
import * as page from './{copy}';

export default {{
  pages: {{
    // A copy of the whole screen, given the app's own screen's props. It
    // replaces `below`; to change the screen a little instead, wrap ctx.below.
    '{screen}': (ctx) => createElement(page['{export}'], ctx.app.props),
  }},
}};
