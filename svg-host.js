import { randomUUID } from 'node:crypto';

export const inject = ['systemPrompt', 'commands', 'tools', 'fs', 'workingDirectory', 'sandboxPolicy'];

export const DIAGRAM_PROMPT = `# Chat diagrams
Use Markdown for ordinary answers. For flowcharts, architecture diagrams, and other static diagrams, prefer one self-contained fenced svg block containing only an <svg> document, without an HTML wrapper. The chat UI renders it directly.
Include xmlns="http://www.w3.org/2000/svg", a viewBox, and a short <title>. Use native SVG shapes, paths, and text, with readable labels, clear arrows, and a layout that fits chat width. Avoid scripts, foreignObject, external resources, and reliance on host CSS. Explanatory prose may accompany the diagram. Use complete HTML only when the user asks for a webpage or interactive HTML content. No rendering tool call is required for SVG.`;

export function createSvgSaver(ctx) {
  return {
    async save(agent, input, signal) {
      if (!agent) throw new Error('需要当前会话');
      const svg = input?.svg;
      if (typeof svg !== 'string' || !/^\s*(?:<\?xml[^?]*\?>\s*)?<svg(?:\s|>)[\s\S]*<\/svg>\s*$/i.test(svg)) throw new Error('需要完整的 SVG 文档');
      if (Buffer.byteLength(svg, 'utf8') > 2 * 1024 * 1024) throw new Error('SVG 超过 2 MiB 保存上限');
      const title = typeof input.title === 'string' ? input.title : 'diagram';
      const stem = title.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 60) || 'diagram';
      const fs = agent.ctx.get('fs') ?? ctx.fs;
      const directory = agent.ctx.get('workingDirectory') ?? ctx.workingDirectory;
      const policyOwner = agent.ctx.get('sandboxPolicy') ?? ctx.sandboxPolicy;
      const target = await fs.resolve(`svg-${stem}-${randomUUID()}.svg`, { cwd: directory.get(agent.session), signal });
      await fs.writeText(target, svg, { kind: 'createIfAbsent' }, signal, policyOwner.resolve({ session: agent.session }));
      return { path: fs.processPath(target), bytes: Buffer.byteLength(svg, 'utf8') };
    },
  };
}

export function apply(ctx) {
  ctx.systemPrompt.section({ name: 'chat-diagrams', order: 150, text: DIAGRAM_PROMPT });
  const saver = createSvgSaver(ctx);
  ctx.provide('svgOutputSaver', saver);
  ctx.commands.register({
    name: 'svg-output-save', description: '将 SVG 图表保存到当前会话工作目录', recordInput: false,
    handler: async ({ agent, rawInput, signal }) => {
      try {
        return { kind: 'success', text: (await saver.save(agent, JSON.parse(rawInput), signal)).path };
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
    },
  });
  ctx.tools.register({
    name: 'svg_output_save',
    description: 'Save an SVG diagram to the current session working directory with a unique filename. Returns its absolute path and byte count.',
    parameters: { type: 'object', properties: {
      svg: { type: 'string', description: 'Standalone SVG document, up to 2 MiB.' },
      title: { type: 'string', description: 'Optional title used in the filename.' },
    }, required: ['svg'], additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { path: { type: 'string' }, bytes: { type: 'number' } }, required: ['path', 'bytes'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args, exec) => saver.save(exec.agent, args, exec.signal),
  });
}
