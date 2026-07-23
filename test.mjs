


const ext = await import("./language-learn.ts");
const { shouldSkipCheck, parseGrammarResult } = ext;

let failures = 0;
function expect(name, actual, want) {
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok) failures++;
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`}`);
}

// --- shouldSkipCheck: things that MUST be skipped ---
expect("slash command", shouldSkipCheck("/reload"), true);
expect("slash with args", shouldSkipCheck("/model anthropic claude something here"), true);
expect("bang command", shouldSkipCheck("!ls -la some directory here"), true);
expect("short: yes", shouldSkipCheck("yes"), true);
expect("short: ok go ahead", shouldSkipCheck("ok go ahead"), true);
expect("code fence", shouldSkipCheck("please fix this\n```ts\nconst x = 1\n```\nwhat is wrong with it exactly"), true);
expect("mostly a path", shouldSkipCheck("look at src/core/extensions/types.ts please"), false); // 1 codey of 5 words = 20% -> checked
expect("mostly code tokens", shouldSkipCheck("const x = foo(bar); y->z; a[i] = {b: 1};"), true);
expect("mostly CJK when learning en (letters ok, LLM decides)", shouldSkipCheck("请帮我修复这个程序里的错误谢谢"), true); // <4 whitespace words
expect("symbols only", shouldSkipCheck("=== !== >>> <<< &&& ||| ??? *** !!!"), true);

// --- shouldSkipCheck: things that MUST be checked ---
expect("normal sentence w/ typo", shouldSkipCheck("I want create a extension to leading English"), false);
expect("question with one path", shouldSkipCheck("why does the loader in loader.ts fail when I reload the extension"), false);
expect("plain 4 words", shouldSkipCheck("please explain this error"), false);

// --- parseGrammarResult ---
expect("clean json", parseGrammarResult('{"skip": false, "items": [{"wrong":"a","right":"b","reason":"c"}], "rephrase": null}'),
	{ skip: false, items: [{ wrong: "a", right: "b", reason: "c" }], rephrase: null });
expect("fenced json", parseGrammarResult('```json\n{"skip": true}\n```'), { skip: true });
expect("json with preamble", parseGrammarResult('Here is the result:\n{"skip": false, "items": []}'), { skip: false, items: [] });
expect("garbage", parseGrammarResult("I cannot help with that"), undefined);
expect("truncated json", parseGrammarResult('{"skip": false, "items": [{"wrong": "a"'), undefined);


// --- segmentMarkdown / cardMarkdown (bilingual card) ---
const { segmentMarkdown, cardMarkdown, buildSegmentPrompt } = ext;

const md = `First, register the handler:

\`\`\`ts
pi.on("x", () => {});
\`\`\`

Then run it. It works.

\`\`\`sh
line1
line2
line3
line4
line5
line6
line7
\`\`\`

Done.`;

const segs = segmentMarkdown(md);
expect("segment kinds", segs.map(s => s.kind), ["prose", "code", "prose", "code", "prose"]);
expect("code line counts", segs.filter(s => s.kind === "code").map(s => s.lines), [1, 7]);
expect("prose texts", segs.filter(s => s.kind === "prose").map(s => s.text),
	["First, register the handler:", "Then run it. It works.", "Done."]);

expect("no code", segmentMarkdown("Just one paragraph.\n\nAnd another."), [
	{ kind: "prose", text: "Just one paragraph." },
	{ kind: "prose", text: "And another." },
]);
expect("unclosed fence", segmentMarkdown("intro\n\n```\ncode").map(s => s.kind), ["prose", "code"]);
expect("empty input", segmentMarkdown(""), []);

const card = cardMarkdown([
	{ kind: "pair", src: "Hello world.", dst: "你好世界。" },
	{ kind: "code", text: "```ts\nx()\n```" },
	{ kind: "codeRef", lines: 23 },
]);
expect("card pair as blockquote", card.includes("Hello world.\n\n> 你好世界。"), true);
expect("card keeps short code", card.includes("```ts\nx()\n```"), true);
expect("card code placeholder", card.includes("*[code block ↑ 23 lines]*"), true);

const cfg = { learning: "en", native: "zh-CN", enabled: true, auto: false, context: false };
const sp = buildSegmentPrompt(["a", "b"], cfg);
expect("segment prompt numbering", sp.includes("[0]\na") && sp.includes("[1]\nb") && sp.includes("exactly 2 strings"), true);
expect("segment prompt has no context preface by default", sp.includes(ext.CONTEXT_PREFACE), false);
expect("contextual segment prompt starts with preface", buildSegmentPrompt(["a"], cfg, true).startsWith(ext.CONTEXT_PREFACE), true);

const wp = ext.buildWholeTranslatePrompt("some text", cfg);
expect("whole prompt wraps source", wp.includes("<<<\nsome text\n>>>"), true);
expect("contextual whole prompt starts with preface", ext.buildWholeTranslatePrompt("x", cfg, true).startsWith(ext.CONTEXT_PREFACE), true);

process.exit(failures ? 1 : 0);
