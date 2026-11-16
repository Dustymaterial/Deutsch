export function containsFloatingTarget(container: HTMLElement | null, target: EventTarget | null) {
  if (!(target instanceof Node) || !container) return false
  if (container.contains(target)) return true
  const owner = target instanceof Element ? target.closest<HTMLElement>('[data-panel-owner]')?.dataset.panelOwner : undefined
  return Boolean(owner && Array.from(container.querySelectorAll('[aria-controls]'))
    .some((element) => element.getAttribute('aria-controls') === owner))
}
