import { customElement } from "solid-element";
import type { ComponentType } from "solid-element";

export const anonymousCustomElement = <T extends object>(
  ComponentType: ComponentType<T>
): CustomElementConstructor =>
  customElement(`watchdeck-${crypto.randomUUID()}`, ComponentType);
