// {title}: {name} ({id}). A component version: it changes {title} wherever
// the app draws it, on every screen. See versions.json for what it changes.
//
// A builder gets ctx.below (what draws it under this version: the app's own,
// or another running version's) and ctx.app (the app's own), and returns one
// of the same kind: a renderer for "components", a part for "parts". Return
// ctx.below to leave it as it is.

export default {{
  components: {{
{components}  }},
  parts: {{
{parts}  }},
}};
