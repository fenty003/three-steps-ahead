/**
 * three-steps-ahead — 把根目录的 SKILL.md 注册成 DSH 运行时技能。
 *
 * 设计要点：
 * - 不复制 SKILL.md 的内容，运行时读文件，保持"一份真理源"。
 * - 不 import 任何 @deepseek-ai/* 包，因此不声明 peerDependencies，
 *   避免宿主升版后 peer 范围不匹配导致整个 profile 装不上（见交接手册 §4.2）。
 * - apply 内部不向外抛异常：读不到文件或服务缺失时只记警告，不拖垮宿主启动。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const name = "three-steps-ahead";

const SKILL_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "SKILL.md");

/**
 * 从 SKILL.md 里拆出 YAML frontmatter 与正文。
 * 只认顶层的 `key: value` 一行式，够用且不引第三方 YAML 解析器。
 */
export function parseSkillDocument(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return undefined;
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!pair) continue;
    let value = pair[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    meta[pair[1]] = value;
  }
  return { meta, body: match[2].trim() };
}

/** 读并校验根目录 SKILL.md；失败返回 undefined 而不是抛错。 */
export function loadSkillDocument(path = SKILL_PATH) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return { error: `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const doc = parseSkillDocument(raw);
  if (!doc) return { error: `${path} has no YAML frontmatter block` };
  const missing = ["name", "description"].filter((key) => !doc.meta[key]);
  if (missing.length > 0) return { error: `${path} frontmatter missing: ${missing.join(", ")}` };
  if (!doc.body) return { error: `${path} body is empty` };
  return { doc };
}

export function apply(ctx) {
  ctx.inject(["skills"], (scoped) => {
    const skills = typeof scoped.get === "function" ? scoped.get("skills") : undefined;
    if (!skills || typeof skills.register !== "function") {
      ctx.logger?.warn?.("[three-steps-ahead] skills.register unavailable; skill not registered");
      return;
    }
    const loaded = loadSkillDocument();
    if (loaded.error) {
      ctx.logger?.warn?.(`[three-steps-ahead] ${loaded.error}`);
      return;
    }
    const { meta, body } = loaded.doc;
    scoped.effect(() =>
      skills.register({
        name: meta.name,
        description: meta.description,
        content: body,
      }),
    );
    ctx.logger?.info?.(
      `[three-steps-ahead] registered skill "${meta.name}" (${body.length} chars)`,
    );
  });
}

export default { name, apply };
