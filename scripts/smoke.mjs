/**
 * 冒烟测试：用假的 cordis ctx 跑一遍 apply，证明插件真能注册出技能。
 * 不依赖 DSH 运行时，纯 Node 即可：node scripts/smoke.mjs
 */
import { apply, loadSkillDocument, parseSkillDocument, name } from "../lib/index.js";

const failures = [];
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

console.log("plugin name:", name);
check("plugin name is three-steps-ahead", name === "three-steps-ahead");

// 1. frontmatter 解析
const sample = '---\nname: demo\ndescription: "含 引号 的 描述"\n---\n\n正文\n';
const parsed = parseSkillDocument(sample);
check("parses frontmatter", parsed?.meta?.name === "demo", JSON.stringify(parsed?.meta));
check("strips surrounding quotes", parsed?.meta?.description === "含 引号 的 描述");
check("keeps body", parsed?.body === "正文");

// 2. 真读 SKILL.md
const loaded = loadSkillDocument();
check("loads real SKILL.md", !loaded.error, loaded.error ?? "");
if (loaded.doc) {
  check("skill name matches package", loaded.doc.meta.name === "three-steps-ahead");
  check("description mentions the %% marker", loaded.doc.meta.description.includes("%%"));
  check("body is substantial (>2000 chars)", loaded.doc.body.length > 2000, String(loaded.doc.body.length));
}

// 3. 用假 ctx 跑 apply，抓 register 的实参
const registered = [];
const warnings = [];
const scoped = {
  get: (service) => (service === "skills" ? { register: (skill) => (registered.push(skill), () => {}) } : undefined),
  effect: (fn) => fn(),
};
const fakeCtx = {
  inject: (deps, callback) => {
    check("injects exactly ['skills']", deps.length === 1 && deps[0] === "skills", JSON.stringify(deps));
    callback(scoped);
  },
  logger: { warn: (m) => warnings.push(m), info: () => {} },
};

apply(fakeCtx);
check("registered exactly one skill", registered.length === 1, `got ${registered.length}`);
const skill = registered[0];
check("registered skill has name", skill?.name === "three-steps-ahead");
check("registered skill has description", typeof skill?.description === "string" && skill.description.length > 0);
check("registered skill has content", typeof skill?.content === "string" && skill.content.length > 2000);
check("no warnings during apply", warnings.length === 0, warnings.join(" | "));

// 4. 服务缺失时不许抛
let threw = false;
try {
  apply({
    inject: (_deps, cb) => cb({ get: () => undefined, effect: (fn) => fn() }),
    logger: { warn: () => {}, info: () => {} },
  });
} catch {
  threw = true;
}
check("survives missing skills service", !threw);

console.log(failures.length === 0 ? "\nALL CHECKS PASSED" : `\n${failures.length} CHECK(S) FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
