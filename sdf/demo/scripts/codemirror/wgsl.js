CodeMirror.defineSimpleMode("wgsl", {
    start: [
      
      {regex: /\b([a-zA-Z0-9_]+)(\s*\()/, token: ["function", null]},
      {regex: /\b(var|vec(2|3|4)|fn|mat[0-9]x[0-9]|f32|i32|u32|bool|struct)\b/, token: "type"},
      {regex: /(@)(location)(\()/, token: [null, "type", null]},
      {regex: /\b([0-9\.-]+)\b/, token:["literal"]},
      {regex: /\b(for|while|if|return)\b/, token: "builtin"},
      {regex: /\/\*/, token: "comment", next: "comment"},
      {regex: /\/\/.*/, token: "comment"},
      {regex: /\b([a-zA-Z0-9_]+)\b/, token : ["variable"]}
    ],
    comment: [
      {regex: /.*?\*\//, token: "comment", next: "start"},
      {regex: /.*/, token: "comment"}
    ],
    meta: {
      dontIndentStates: ["comment"],
      lineComment: "//"
    }
  });