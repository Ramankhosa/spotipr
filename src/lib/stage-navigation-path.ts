export function getStageNavigationPath<TStage extends string>(
  order: readonly TStage[],
  currentStage: TStage,
  targetStage: TStage
): TStage[] {
  if (currentStage === targetStage) return []

  const currentIndex = order.indexOf(currentStage)
  const targetIndex = order.indexOf(targetStage)

  if (currentIndex === -1 || targetIndex === -1) {
    return [targetStage]
  }

  if (targetIndex > currentIndex) {
    return order.slice(currentIndex + 1, targetIndex + 1)
  }

  return order.slice(targetIndex, currentIndex).reverse()
}
