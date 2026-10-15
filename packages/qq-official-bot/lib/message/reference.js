"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseReferenceMessage = parseReferenceMessage;
const MAX_LENGTH = 64 * 1024;
const MAX_DEPTH = 16;
const MAX_NODES = 100;
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function dedent(content) {
    const lines = content.split('\n');
    const indent = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^[ \t]*/)?.[0].length || 0));
    return Number.isFinite(indent) && indent > 0 ? lines.map(line => line.slice(indent)).join('\n') : content;
}
function parseSections(content, nested, depth, budget) {
    if (depth >= MAX_DEPTH)
        return;
    // 只拆当前层的标记；下层标记带缩进，递归前再统一去缩进。
    const marker = nested ? /^--- 第\d+条 ---$/gm : /^=== 消息 \d+ ===$/gm;
    const matches = [...content.matchAll(marker)];
    if (!matches.length || content.slice(0, matches[0].index).trim())
        return;
    const nodes = [];
    for (let index = 0; index < matches.length; index++) {
        if (budget.remaining-- <= 0)
            return;
        const start = matches[index].index + matches[index][0].length;
        const end = matches[index + 1]?.index ?? content.length;
        const body = dedent(content.slice(start, end).replace(/^\n/, '').replace(/\n+$/, ''));
        const match = body.match(/^\[消息内容\][ \t]?([\s\S]*?)\n\[消息类型\][ \t]*([^\n]+)(?:\n\[关联消息\]\n([\s\S]+))?$/);
        if (!match)
            return;
        const node = { content: match[1] };
        if (match[3]) {
            const children = parseSections(dedent(match[3]), true, depth + 1, budget);
            if (!children)
                return;
            node.children = children;
        }
        nodes.push(node);
    }
    return nodes;
}
/** 解析 message_type=103 的引用快照，不推测或重写消息 ID。 */
function parseReferenceMessage(payload) {
    if (Number(payload.message_type) !== 103)
        return;
    const elements = Array.isArray(payload.msg_elements) ? payload.msg_elements : [];
    const parallel = record(payload.parallel_message);
    const parallelNodes = Array.isArray(parallel?.msg_nodes) ? parallel.msg_nodes : [];
    const nodes = [];
    const unparsed = [];
    let remainingLength = MAX_LENGTH;
    const budget = { remaining: MAX_NODES };
    let truncated = elements.length > MAX_NODES || parallelNodes.length > MAX_NODES;
    const boundedText = (text) => {
        const bounded = text.slice(0, remainingLength);
        remainingLength -= bounded.length;
        if (bounded.length < text.length)
            truncated = true;
        return bounded;
    };
    for (const value of elements.slice(0, MAX_NODES)) {
        const element = record(value);
        if (!element || typeof element.content !== 'string')
            continue;
        const content = boundedText(element.content);
        const normalized = content.replace(/\r\n/g, '\n').replace(/\n+$/, '');
        if (/^=== 消息 \d+ ===(?:\n|$)/.test(normalized)) {
            const parsed = parseSections(normalized, false, 0, budget);
            if (parsed)
                nodes.push(...parsed);
            else
                unparsed.push(content);
        }
        else if (element.message_type !== undefined || typeof element.msg_idx === 'string') {
            if (budget.remaining-- <= 0) {
                truncated = true;
                break;
            }
            nodes.push({
                content,
                ...(typeof element.msg_idx === 'string' && element.msg_idx ? { msg_idx: element.msg_idx } : {}),
            });
        }
        else if (content) {
            unparsed.push(content);
        }
    }
    // 完整快照优先；快照缺失或格式变化时仍保留直接引用内容。
    if (!nodes.length) {
        for (const value of parallelNodes.slice(0, MAX_NODES)) {
            const node = record(value);
            if (!node || typeof node.content !== 'string')
                continue;
            nodes.push({ content: boundedText(node.content) });
        }
    }
    if (!nodes.length && !unparsed.length && !truncated)
        return;
    return {
        nodes,
        ...(unparsed.length ? { raw: unparsed.join('\n') } : {}),
        ...(truncated || budget.remaining < 0 ? { truncated: true } : {}),
    };
}
