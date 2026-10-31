import type { ComponentType } from 'react';

export type AdminView = { id: string; label: string; component: ComponentType };
export type AdminWidget = { id: string; component: ComponentType };

/** Pages an extension adds to the panel. They show in the sidebar, at `#/views/<id>`. */
export const VIEW_REGISTRY = new Map<string, AdminView>();
/** Cards an extension adds to the dashboard. */
export const WIDGET_REGISTRY = new Map<string, AdminWidget>();

export function registerView(view: AdminView): void {
  VIEW_REGISTRY.set(view.id, view);
}

export function registerWidget(widget: AdminWidget): void {
  WIDGET_REGISTRY.set(widget.id, widget);
}
