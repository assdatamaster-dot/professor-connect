import type {
  UpdateRendererApi,
  UpdateSettings,
  UpdateSettingsInput,
  UpdateState,
} from '../contracts.js';

declare global {
  interface Window {
    professorConnectUpdate?: UpdateRendererApi;
  }
}

export class UpdateRendererController {
  private state: UpdateState | undefined;
  private settings: UpdateSettings | undefined;
  private readonly root = document.createElement('section');
  private readonly toast = document.createElement('aside');
  private readonly dialog = document.createElement('dialog');

  public constructor(private readonly api: UpdateRendererApi) {
    this.root.className = 'pc-update-root';
    this.toast.className = 'pc-update-toast';
    this.toast.setAttribute('aria-live', 'polite');
    this.dialog.className = 'pc-update-dialog';
  }

  public async mount(): Promise<void> {
    installStyles();
    document.body.append(this.root, this.toast, this.dialog);
    this.root.innerHTML =
      '<button class="pc-update-trigger" type="button" aria-label="Abrir atualizações"><span>↻</span> Atualizações</button>';
    this.root.querySelector('button')?.addEventListener('click', () => void this.openSettings());
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
    this.api.onStateChanged((state) => {
      this.state = state;
      this.renderState();
    });
    this.state = await this.api.getState();
    this.settings = await this.api.getSettings();
    this.renderState();
  }

  private renderState(): void {
    const state = this.state;
    if (state === undefined) return;
    if (!['available', 'downloading', 'downloaded', 'deferred', 'error'].includes(state.phase)) {
      this.toast.hidden = true;
      return;
    }
    this.toast.hidden = false;
    this.toast.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = state.message;
    this.toast.append(heading);
    if (state.phase === 'downloading' && state.progress !== undefined) {
      const bar = document.createElement('progress');
      bar.max = 100;
      bar.value = state.progress.percent;
      const details = document.createElement('small');
      details.textContent = `${Math.round(state.progress.percent)}% · ${formatSpeed(state.progress.bytesPerSecond)} · ${formatRemaining(state.progress.remainingSeconds)}`;
      this.toast.append(bar, details);
    } else if (state.newVersion !== undefined) {
      const versions = document.createElement('small');
      versions.textContent = `Versão ${state.currentVersion} → ${state.newVersion}`;
      this.toast.append(versions);
    }
    const actions = document.createElement('div');
    if (state.phase === 'available') {
      actions.append(this.actionButton('Baixar agora', () => this.api.download(), true));
    }
    if (state.phase === 'downloaded') {
      actions.append(
        this.actionButton('Reiniciar agora', () => this.api.install(), true),
        this.actionButton('Depois', () => this.api.defer()),
      );
    }
    if (state.releaseNotes !== undefined && state.releaseNotes.raw.length > 0) {
      actions.append(this.actionButton('Ver novidades', async () => this.openReleaseNotes()));
    }
    if (state.phase === 'error') {
      actions.append(this.actionButton('Tentar novamente', () => this.api.check(), true));
    }
    this.toast.append(actions);
  }

  private async openSettings(): Promise<void> {
    this.settings = await this.api.getSettings();
    const settings = this.settings;
    this.dialog.replaceChildren();
    const form = document.createElement('form');
    form.method = 'dialog';
    form.innerHTML = `
      <header><div><span>Professor Connect</span><h2>Atualizações</h2></div><button value="cancel" aria-label="Fechar">×</button></header>
      <p class="pc-update-intro">Mantenha segurança, estabilidade e novos recursos sempre em dia.</p>
      <label class="pc-update-option"><span><strong>Atualização automática</strong><small>Baixar silenciosamente em segundo plano</small></span><input name="automaticDownload" type="checkbox"></label>
      <label><span>Canal de atualização</span><select name="channel"><option value="stable">Stable</option><option value="beta">Beta</option><option value="development">Development</option></select></label>
      <label><span>Intervalo de verificação</span><select name="checkIntervalMinutes"><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="360">6 horas</option><option value="1440">24 horas</option></select></label>
      <label class="pc-update-option pc-update-locked"><span><strong>Somente fora de atendimento</strong><small>Proteção obrigatória para chamada, tela, arquivos e controle remoto</small></span><input type="checkbox" checked disabled></label>
      <label class="pc-update-option"><span><strong>Atualizar ao fechar</strong><small>Instala automaticamente quando for seguro</small></span><input name="installOnAppQuit" type="checkbox"></label>
      <footer><button class="pc-update-secondary" type="button" data-check>Verificar agora</button><button class="pc-update-primary" value="save">Salvar</button></footer>`;
    const automatic = form.elements.namedItem('automaticDownload');
    const channel = form.elements.namedItem('channel');
    const interval = form.elements.namedItem('checkIntervalMinutes');
    const installOnQuit = form.elements.namedItem('installOnAppQuit');
    if (automatic instanceof HTMLInputElement) automatic.checked = settings.automaticDownload;
    if (channel instanceof HTMLSelectElement) channel.value = settings.channel;
    if (interval instanceof HTMLSelectElement)
      interval.value = String(settings.checkIntervalMinutes);
    if (installOnQuit instanceof HTMLInputElement)
      installOnQuit.checked = settings.installOnAppQuit;
    form.querySelector('[data-check]')?.addEventListener('click', () => void this.api.check());
    form.addEventListener('submit', (event) => {
      if (event.submitter instanceof HTMLButtonElement && event.submitter.value === 'save') {
        event.preventDefault();
        const input: UpdateSettingsInput = {
          automaticDownload: automatic instanceof HTMLInputElement && automatic.checked,
          channel:
            channel instanceof HTMLSelectElement
              ? (channel.value as UpdateSettings['channel'])
              : settings.channel,
          checkIntervalMinutes:
            interval instanceof HTMLSelectElement
              ? Number(interval.value)
              : settings.checkIntervalMinutes,
          installOnAppQuit: installOnQuit instanceof HTMLInputElement && installOnQuit.checked,
        };
        void this.api.saveSettings(input).then((saved) => {
          this.settings = saved;
          this.dialog.close();
        });
      }
    });
    this.dialog.append(form);
    this.dialog.showModal();
  }

  private openReleaseNotes(): void {
    const state = this.state;
    if (state?.releaseNotes === undefined) return;
    this.dialog.replaceChildren();
    const container = document.createElement('article');
    const header = document.createElement('header');
    const heading = document.createElement('h2');
    heading.textContent = `Novidades da versão ${state.newVersion ?? ''}`;
    const close = document.createElement('button');
    close.textContent = '×';
    close.addEventListener('click', () => this.dialog.close());
    header.append(heading, close);
    container.append(header);
    for (const [title, entries] of [
      ['Novidades', state.releaseNotes.news],
      ['Correções', state.releaseNotes.fixes],
      ['Melhorias', state.releaseNotes.improvements],
    ] as const) {
      if (entries.length === 0) continue;
      const section = document.createElement('section');
      const sectionTitle = document.createElement('h3');
      sectionTitle.textContent = title;
      const list = document.createElement('ul');
      for (const entry of entries) {
        const item = document.createElement('li');
        item.textContent = entry;
        list.append(item);
      }
      section.append(sectionTitle, list);
      container.append(section);
    }
    const meta = document.createElement('small');
    meta.textContent =
      state.releaseDate === undefined
        ? ''
        : new Date(state.releaseDate).toLocaleDateString('pt-BR');
    container.append(meta);
    this.dialog.append(container);
    this.dialog.showModal();
  }

  private actionButton(
    label: string,
    action: () => Promise<unknown>,
    primary = false,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'pc-update-primary' : 'pc-update-secondary';
    button.textContent = label;
    button.addEventListener('click', () => void action());
    return button;
  }
}

function installStyles(): void {
  if (document.querySelector('#pc-update-styles') !== null) return;
  const style = document.createElement('style');
  style.id = 'pc-update-styles';
  style.textContent = `
    .pc-update-trigger{position:fixed;right:18px;bottom:16px;z-index:950;border:1px solid #dce3ef;background:#fff;color:#344054;border-radius:999px;padding:8px 13px;font:600 12px system-ui;box-shadow:0 5px 18px #1018281c;cursor:pointer}.pc-update-trigger span{font-size:16px;color:#3157d5}.pc-update-toast{position:fixed;right:18px;bottom:62px;z-index:951;width:min(360px,calc(100vw - 36px));box-sizing:border-box;padding:16px;border:1px solid #dce3ef;border-radius:16px;background:#fff;color:#101828;box-shadow:0 18px 50px #10182826;font:14px system-ui}.pc-update-toast[hidden]{display:none}.pc-update-toast strong,.pc-update-toast small{display:block}.pc-update-toast small{margin-top:5px;color:#667085}.pc-update-toast progress{display:block;width:100%;height:7px;margin-top:12px;accent-color:#3157d5}.pc-update-toast div{display:flex;gap:8px;margin-top:13px;flex-wrap:wrap}.pc-update-primary,.pc-update-secondary{border:0;border-radius:9px;padding:9px 13px;font:600 13px system-ui;cursor:pointer}.pc-update-primary{background:#3157d5;color:#fff}.pc-update-secondary{background:#eef2f8;color:#344054}.pc-update-dialog{width:min(520px,calc(100vw - 32px));box-sizing:border-box;padding:0;border:0;border-radius:20px;color:#101828;background:#fff;box-shadow:0 24px 80px #10182842;font:14px system-ui}.pc-update-dialog::backdrop{background:#10182875;backdrop-filter:blur(3px)}.pc-update-dialog form,.pc-update-dialog article{padding:24px}.pc-update-dialog header{display:flex;align-items:flex-start;justify-content:space-between;gap:15px}.pc-update-dialog header span{color:#3157d5;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.08em}.pc-update-dialog h2{margin:4px 0 0;font-size:23px}.pc-update-dialog header>button{border:0;background:transparent;color:#667085;font-size:25px;cursor:pointer}.pc-update-intro{color:#667085;margin:12px 0 20px}.pc-update-dialog label{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:14px 0;border-top:1px solid #edf0f5}.pc-update-dialog label>span{display:flex;flex-direction:column;gap:3px}.pc-update-dialog label small{color:#667085}.pc-update-dialog select{min-width:145px;border:1px solid #d0d5dd;border-radius:9px;padding:8px;background:#fff}.pc-update-dialog input[type=checkbox]{width:39px;height:21px;accent-color:#3157d5}.pc-update-locked{opacity:.78}.pc-update-dialog footer{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}.pc-update-dialog article section{margin-top:20px;padding:15px;border-radius:12px;background:#f7f9fc}.pc-update-dialog article h3{margin:0;color:#3157d5;font-size:14px}.pc-update-dialog article ul{margin:10px 0 0;padding-left:20px;color:#475467}.pc-update-dialog article>small{display:block;margin-top:18px;color:#667085}@media(prefers-color-scheme:dark){.pc-update-trigger,.pc-update-toast,.pc-update-dialog{background:#151a24;color:#f2f4f7;border-color:#344054}.pc-update-secondary{background:#273142;color:#e4e7ec}.pc-update-dialog select{background:#1d2430;color:#fff;border-color:#475467}.pc-update-dialog article section{background:#1d2430}}
  `;
  document.head.append(style);
}

function formatSpeed(bytes: number): string {
  if (bytes < 1_024) return `${Math.round(bytes)} B/s`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB/s`;
  return `${(bytes / 1_048_576).toFixed(1)} MB/s`;
}

function formatRemaining(seconds: number | undefined): string {
  if (seconds === undefined) return 'calculando tempo';
  if (seconds < 60) return `${seconds}s restantes`;
  return `${Math.ceil(seconds / 60)} min restantes`;
}

if (window.professorConnectUpdate !== undefined) {
  void new UpdateRendererController(window.professorConnectUpdate).mount();
}
