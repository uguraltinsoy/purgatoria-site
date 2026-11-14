declare module 'frappe-gantt' {
  export default class Gantt {
    constructor(element: string | HTMLElement, tasks: any[], options?: any);
    change_view_mode(mode: string): void;
    bind_bar_events(): void;
    bind_bar_progress(): void;
  }
}
