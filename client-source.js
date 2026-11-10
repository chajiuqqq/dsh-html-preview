window.__ModuleLoader__.load({
  id: '@local/dsh-html-output-client-compat',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const fence = /```(html|svg)[^\r\n]*\r?\n([\s\S]*?)\r?\n```(?=[ \t]*(?:\r?\n|$))/gi;

    function assistantText(turn) {
      const parts = [];
      for (const step of turn?.steps ?? []) {
        const data = step?.data?.get?.('assistant-step');
        if (!data) continue;
        for (const block of data.blocks ?? []) {
          if (block.kind === 'text' && typeof block.text === 'string') parts.push(block.text);
        }
      }
      return parts.join('\n');
    }

    function extract(owner) {
      const text = assistantText(owner?.turn ?? {});
      fence.lastIndex = 0;
      let match;
      let html = null;
      let kind = 'html';
      while ((match = fence.exec(text)) !== null) {
        const value = (match[2] ?? '').trim();
        if (value) {
          html = value;
          kind = match[1].toLowerCase();
          if (/^(?:<\?xml[^?]*\?>\s*)?<svg(?:\s|>)/i.test(value)) kind = 'svg';
        }
      }
      if (!html) return null;
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
        ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const title = titleMatch?.[1]?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      return { html, kind, ...(title ? { title: title.slice(0, 80) } : {}) };
    }

    function documentSource(html) {
      if (/<!doctype\s+html/i.test(html) || /<html[\s>]/i.test(html)) return html;
      return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font:15px system-ui,sans-serif;line-height:1.5}</style></head><body>' + html + '</body></html>';
    }

    const cardStyle = {
      margin: '12px 0', border: '1px solid var(--dsw-border, rgba(128,128,128,.35))',
      borderRadius: 10, overflow: 'hidden', background: 'var(--dsw-surface, rgba(128,128,128,.06))',
    };
    const barStyle = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      padding: '7px 10px', borderBottom: '1px solid var(--dsw-border, rgba(128,128,128,.25))',
    };
    // Read only the current turn's rendered code blocks. Styles remain owned by
    // this component and disappear on unmount; message data and DOM are untouched.
    function useSourceSuppression(ref, html, previewId) {
      const [css, setCss] = React.useState('');
      React.useEffect(() => {
        const tail = ref.current?.closest('[data-chat-flow-kind="turn-tail"]');
        const root = tail?.parentElement;
        if (!root) return;
        let frame = 0;
        const refresh = () => {
          frame = 0;
          const rules = [];
          const scope = `:has(> [data-chat-flow-kind="turn-tail"] [data-html-preview-id="${CSS.escape(previewId)}"])`;
          for (const flow of root.children) {
            if (flow.dataset.chatFlowKind !== 'assistant-step' || flow.dataset.chatTurn !== tail.dataset.chatTurn) continue;
            for (const block of flow.querySelectorAll('.md-code-block')) {
              const code = block.querySelector('[data-code-block-content] pre');
              if (!code || code.textContent.trim() !== html.trim()) continue;
              let path = '';
              let node = block;
              while (node && node !== flow) {
                const index = Array.prototype.indexOf.call(node.parentElement.children, node) + 1;
                path = ` > :nth-child(${index})` + path;
                node = node.parentElement;
              }
              if (node === flow) rules.push(`${scope} > [data-chat-node-key="${CSS.escape(flow.dataset.chatNodeKey)}"]${path}{display:none!important}`);
            }
          }
          const next = rules.join('\n');
          setCss(previous => previous === next ? previous : next);
        };
        const observer = new MutationObserver(() => {
          if (!frame) frame = requestAnimationFrame(refresh);
        });
        observer.observe(root, { childList: true, subtree: true, characterData: true });
        refresh();
        return () => {
          observer.disconnect();
          if (frame) cancelAnimationFrame(frame);
        };
      }, [html, previewId]);
      return css;
    }

    function exportDocument(html) {
      const script = `
        window.addEventListener('message', async event => {
          if (event.source !== parent || event.data?.type !== 'dsh-html-png') return;
          const id = event.data.id;
          try {
            await document.fonts.ready;
            const width = Math.max(document.documentElement.scrollWidth, innerWidth);
            const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
            if (width * height > 24000000 || height > 20000) throw new Error('页面过大，无法导出 PNG');
            const canvas = await html2canvas(document.documentElement, {
              backgroundColor: '#ffffff', scale: 1, width, height,
              windowWidth: innerWidth, windowHeight: innerHeight,
              useCORS: true, allowTaint: false, logging: false, imageTimeout: 10000,
            });
            parent.postMessage({ type: 'dsh-html-png-result', id, png: canvas.toDataURL('image/png') }, '*');
          } catch (error) {
            parent.postMessage({ type: 'dsh-html-png-result', id, error: error.message || String(error) }, '*');
          }
        });`;
      return documentSource(html) + '<script>' + captureLibrary.replace(/<\/script/gi, '<\\/script') + '\n' + script + '</script>';
    }

    // Correlation only: responses must also come from this exact iframe.
    // A module-local sequence works on HTTP pages without secure-context APIs.
    let captureSequence = 0;
    function captureFrame(frame, signal) {
      return new Promise((resolve, reject) => {
        const id = `html-png-${Date.now()}-${++captureSequence}`;
        const finish = (error, value) => {
          clearTimeout(timer);
          window.removeEventListener('message', receive);
          signal.removeEventListener('abort', abort);
          error ? reject(error) : resolve(value);
        };
        const abort = () => finish(new Error('导出已取消'));
        const receive = event => {
          if (event.source !== frame.contentWindow || event.data?.type !== 'dsh-html-png-result' || event.data.id !== id) return;
          finish(event.data.error ? new Error(event.data.error) : null, event.data.png);
        };
        const timer = setTimeout(() => finish(new Error('PNG 渲染超时，请等待页面加载后重试')), 30000);
        window.addEventListener('message', receive);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) return abort();
        frame.contentWindow.postMessage({ type: 'dsh-html-png', id }, '*');
      });
    }

    function prepareSvg(source) {
      try {
        const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
        const svg = doc.documentElement;
        if (doc.querySelector('parsererror') || svg.localName !== 'svg') throw new Error('SVG 格式无效，请检查标签和 XML 转义');
        const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        const dimension = name => {
          const value = svg.getAttribute(name) || '';
          return /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? parseFloat(value) : 0;
        };
        const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;
        const width = hasBox ? box[2] : dimension('width') || 800;
        const height = hasBox ? box[3] : dimension('height') || 450;
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        if (!hasBox) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        const text = new XMLSerializer().serializeToString(svg);
        return { text, url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text), width, height };
      } catch (error) {
        return { error: error.message || String(error) };
      }
    }

    function captureSvg(svg, signal) {
      return new Promise((resolve, reject) => {
        if (svg.error) return reject(new Error(svg.error));
        const width = Math.ceil(Math.min(1600, Math.max(600, svg.width)));
        const height = Math.ceil(width * svg.height / svg.width);
        if (width * height > 24000000 || height > 20000) return reject(new Error('图表过大，无法导出 PNG'));
        const image = new Image();
        const finish = (error, value) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          image.onload = image.onerror = null;
          image.src = '';
          error ? reject(error) : resolve(value);
        };
        const abort = () => finish(new Error('导出已取消'));
        const timer = setTimeout(() => finish(new Error('SVG 渲染超时')), 30000);
        image.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('浏览器不支持 Canvas 导出');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            context.drawImage(image, 0, 0, width, height);
            finish(null, canvas.toDataURL('image/png'));
          } catch (error) { finish(error); }
        };
        image.onerror = () => finish(new Error('SVG 图片加载失败，请使用自包含 SVG'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) return abort();
        image.src = svg.url;
      });
    }

    function commandResult(response) {
      if (!response?.ok) throw new Error(response?.error?.message || '保存请求失败');
      const result = response.value?.result;
      if (!result) throw new Error('保存命令不可用');
      if (result.kind !== 'success') throw new Error(result.text || '保存失败');
      return result;
    }

    const Card = React.memo(function Card({ html, kind, title, sessionId, saveHtml }) {
      const isSvg = kind === 'svg';
      const svg = React.useMemo(() => isSvg ? prepareSvg(html) : null, [html, isSvg]);
      const [saving, setSaving] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const busy = React.useRef(false);
      const frame = React.useRef(null);
      const menu = React.useRef(null);
      const controller = React.useRef(null);
      React.useEffect(() => () => controller.current?.abort(), []);
      // data: keeps the preview on a unique opaque origin, distinct from the app.
      // allow-same-origin then lets html2canvas access its own inherited-origin
      // about:blank clone. Never pair this permission with srcDoc or a host blob URL.
      const frameSrc = React.useMemo(() => isSvg ? null : 'data:text/html;charset=utf-8,' + encodeURIComponent(exportDocument(html)), [html, isSvg]);
      const save = async format => {
        if (menu.current) menu.current.open = false;
        if (busy.current) return;
        busy.current = true;
        controller.current = new AbortController();
        setSaving(true);
        setNotice('');
        try {
          if (isSvg && svg.error) throw new Error(svg.error);
          const input = format === 'png'
            ? { format, png: await (isSvg ? captureSvg(svg, controller.current.signal) : captureFrame(frame.current, controller.current.signal)), title }
            : format === 'svg' ? { format, svg: svg.text, title }
            : { format, html: documentSource(html), title };
          const result = commandResult(await saveHtml(sessionId, input));
          setNotice(`已保存：${result.text}`);
        } catch (error) {
          setNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          busy.current = false;
          setSaving(false);
        }
      };
      const ref = React.useRef(null);
      const previewId = React.useId();
      const css = useSourceSuppression(ref, svg?.error ? '' : html, previewId);
      const itemStyle = { display: 'block', width: '100%', padding: '8px 14px', color: 'inherit', background: 'transparent', border: 0, textAlign: 'left', font: 'inherit', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' };
      return h('section', { ref, style: { ...cardStyle, overflow: 'visible' }, 'data-html-preview-id': previewId },
        h('style', null, css),
        h('header', { style: barStyle },
          h('strong', { style: { fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
          h('details', { ref: menu, style: { position: 'relative', flexShrink: 0 },
            onKeyDown: event => { if (event.key === 'Escape') { menu.current.open = false; menu.current.querySelector('summary').focus(); } },
            onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; } },
            h('summary', { 'aria-label': '导出选项', title: '导出选项', style: { listStyle: 'none', cursor: 'pointer', padding: '0 8px', fontSize: 22, lineHeight: '28px' } }, '⋯'),
            h('div', { style: { position: 'absolute', right: 0, top: '100%', zIndex: 10, minWidth: 150, borderRadius: 8, border: '1px solid currentColor', background: 'var(--dsw-alias-bg-base, Canvas)', color: 'var(--dsw-alias-text-primary, CanvasText)', padding: '4px 0' } },
              h('button', { type: 'button', disabled: saving || !sessionId || Boolean(svg?.error), style: itemStyle, onClick: () => save(isSvg ? 'svg' : 'html') }, isSvg ? '保存为 SVG' : '保存为 HTML'),
              h('button', { type: 'button', disabled: saving || !sessionId, style: itemStyle, onClick: () => save('png') }, '保存为 PNG')))),
        (notice || saving) && h('div', { role: 'status', style: { padding: '6px 10px', fontSize: 12, overflowWrap: 'anywhere' } }, saving ? '正在保存…' : notice),
        isSvg
          ? svg.error
            ? h('div', { role: 'alert', style: { padding: 16 } }, svg.error)
            : h('img', { alt: title, src: svg.url, style: { display: 'block', width: '100%', height: 'auto', borderRadius: '0 0 10px 10px', background: '#fff' } })
          : h('iframe', { ref: frame, title, sandbox: 'allow-scripts allow-same-origin', src: frameSrc, style: { display: 'block', width: '100%', height: 420, border: 0, borderRadius: '0 0 10px 10px', background: '#fff' } }));
    });

    const Preview = React.memo(function Preview({ turn, sessionId, saveHtml }) {
      const matched = extract({ turn });
      return matched ? h(Card, { html: matched.html, kind: matched.kind, title: matched.title || (matched.kind === 'svg' ? 'SVG 图表' : 'HTML 输出'), sessionId, saveHtml }) : null;
    });

    return {
      inject: ['slots', 'remote', 'remote.commands'],
      apply(ctx) {
        const saveHtml = (sessionId, input) => ctx.remote.commands.execute(sessionId, (input.format === 'svg' ? '/svg-output-save ' : '/html-output-save ') + JSON.stringify(input), []);
        const ConnectedPreview = props => h(Preview, { ...props, saveHtml });
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'html-output-preview-compat',
          order: 150,
        }, ConnectedPreview));
      },
    };
  },
});
