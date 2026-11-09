import { randomUUID } from 'node:crypto';

export const inject = ['commands', 'tools', 'fs', 'workingDirectory', 'sandboxPolicy', 'shell'];

export function createSaver(ctx) {
  return {
    async save(agent, input, signal) {
      if (!agent) throw new Error('需要当前会话');
      if (!input || (input.format !== undefined && !['html', 'png'].includes(input.format))) throw new Error('无效的导出格式');
      const format = input.format ?? 'html';
      let png;
      if (format === 'png') {
        if (typeof input.png !== 'string' || input.png.length > 44 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.png)) throw new Error('无效或过大的 PNG 数据');
        png = Buffer.from(input.png.slice('data:image/png;base64,'.length), 'base64');
        if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('PNG 文件头无效');
      } else {
        if (typeof input.html !== 'string' || !input.html.trim()) throw new Error('HTML 内容不能为空');
        if (Buffer.byteLength(input.html, 'utf8') > 2 * 1024 * 1024) throw new Error('HTML 超过 2 MiB 保存上限');
      }
      const title = typeof input.title === 'string' ? input.title : 'HTML 输出';
      const stem = title.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 60) || 'html-output';
      const filename = `html-${stem}-${randomUUID()}.${format}`;
      const fs = agent.ctx.get('fs') ?? ctx.fs;
      const directory = agent.ctx.get('workingDirectory') ?? ctx.workingDirectory;
      const policyOwner = agent.ctx.get('sandboxPolicy') ?? ctx.sandboxPolicy;
      const cwd = directory.get(agent.session);
      const target = await fs.resolve(filename, { cwd, signal });
      if (format === 'png') {
        const shell = agent.ctx.get('shell') ?? ctx.shell;
        const script = "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));fs.writeFileSync(data.path,Buffer.from(data.png,'base64'),{flag:'wx'});";
        const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
        const job = await shell.execute(shell.resolve({
          command: 'node -e ' + quote(script), workdir: cwd,
          stdin: JSON.stringify({ path: fs.processPath(target), png: png.toString('base64') }),
          timeoutMs: 15000, onExpiry: 'kill', stdoutMaxBytes: 4096, signal,
          sandboxPolicy: policyOwner.resolve({ session: agent.session }),
        }));
        const result = await job.result();
        if (result.exitCode !== 0 || result.timedOut || result.aborted) throw new Error(result.stderr.text || 'PNG 保存失败');
        return { path: fs.processPath(target), bytes: png.length };
      }
      const html = /<!doctype\s+html/i.test(input.html) || /<html[\s>]/i.test(input.html)
        ? input.html
        : '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + input.html + '</body></html>';
      await fs.writeText(target, html, { kind: 'createIfAbsent' }, signal, policyOwner.resolve({ session: agent.session }));
      return { path: fs.processPath(target), bytes: Buffer.byteLength(html, 'utf8') };
    },
  };
}

export function apply(ctx) {
  const saver = createSaver(ctx);
  ctx.provide('htmlOutputSaver', saver);
  ctx.commands.register({
    name: 'html-output-save',
    description: '将 HTML 卡片保存到当前会话工作目录',
    recordInput: false,
    handler: async ({ agent, rawInput, signal }) => {
      try {
        const result = await saver.save(agent, JSON.parse(rawInput), signal);
        return { kind: 'success', text: result.path };
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
    },
  });
  ctx.tools.register({
    name: 'html_output_save',
    description: 'Save HTML or PNG from an HTML preview to the current session working directory with a unique filename. Returns its absolute path and byte count.',
    parameters: { type: 'object', properties: {
      format: { type: 'string', enum: ['html', 'png'], description: 'Export format; defaults to html.' },
      html: { type: 'string', description: 'Required for HTML: document or fragment, up to 2 MiB.' },
      png: { type: 'string', description: 'Required for PNG: rendered image as a data:image/png;base64 URL, up to 32 MiB decoded.' },
      title: { type: 'string', description: 'Optional title used in the generated filename.' },
    }, additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { path: { type: 'string' }, bytes: { type: 'number' } }, required: ['path', 'bytes'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args, exec) => saver.save(exec.agent, args, exec.signal),
  });
}
