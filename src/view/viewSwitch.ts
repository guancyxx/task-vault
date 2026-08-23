// Shared cross-view switch bar (FR-036 nit): renders 任务/项目/日程 links so every panel can reach
// its siblings — closes the one-directional gap where Agenda/Calendar were dead-ends. Mirrors H7's
// tv-projects-link form (same class, same header placement); a link renders only when its handler is
// wired, so the current panel omits its own self-link.

import type { T } from '../i18n';

export interface ViewSwitchHandlers {
  openTasks?: () => void;
  openProjects?: () => void;
  openAgenda?: () => void;
}

export function renderViewSwitch(bar: HTMLElement, t: T, h: ViewSwitchHandlers): void {
  addLink(bar, t('sidebar.tasks'), h.openTasks);
  addLink(bar, t('sidebar.projects'), h.openProjects);
  addLink(bar, t('sidebar.agenda'), h.openAgenda);
}

function addLink(bar: HTMLElement, text: string, onClick?: () => void): void {
  if (!onClick) return;
  const link = bar.createSpan({ cls: 'tv-projects-link', text });
  link.addEventListener('click', onClick);
}
