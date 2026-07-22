import type { InjectionKey, Ref } from 'vue'

/**
 * Bulk expand/collapse contract shared between the details panel
 * (`DetailsSlideover`) and every recursive `JsonTree` node.
 *
 * Each `JsonTree` branch owns its local `expanded` state, so a "collapse/expand
 * all" action can't reach into them directly. Instead the panel provides a
 * single reactive `JsonTreeBulk` pulse: every time the user toggles the button
 * it bumps `nonce` and sets the target `expanded`. Branch nodes watch `nonce`
 * and apply `expanded`, which — because collapsed branches unmount their
 * children — cascades to full depth in both directions.
 */
export interface JsonTreeBulk {
  /** Target expanded state to apply on the latest pulse. */
  expanded: boolean
  /** Bumped each time a bulk apply is requested. */
  nonce: number
}

/** Injection key for the reactive {@link JsonTreeBulk} pulse. */
export const JSON_TREE_BULK_KEY: InjectionKey<Ref<JsonTreeBulk>>
  = Symbol('jsonTreeBulk')
