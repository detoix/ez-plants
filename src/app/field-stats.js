/** Fold the four PlantField reports into the single HUD contract. */
export function aggregateFieldStats(fields, culling) {
  const total = {
    plants: 0,
    prototypes: 0,
    drawCalls: 0,
    organDrawCalls: 0,
    woodDrawCalls: 0,
    organInstances: 0,
    budget: 0,
    overBudget: false,
    levelCounts: [],
    visiblePlants: 0,
    repacks: 0,
    instanceWrites: 0,
    slots: 0,
    unusedSlots: 0,
    slotsByKind: {},
    culling,
  };

  for (const entry of fields) {
    const stats = entry.field.stats();
    total.plants += stats.plants;
    total.prototypes += stats.prototypes;
    total.drawCalls += stats.drawCalls;
    total.organDrawCalls += stats.organDrawCalls;
    total.woodDrawCalls += stats.woodDrawCalls;
    total.organInstances += stats.organInstances;
    total.budget += stats.budget;
    total.overBudget ||= stats.overBudget;
    total.visiblePlants += stats.visiblePlants;
    total.repacks += stats.repacks;
    total.instanceWrites += stats.instanceWrites;
    total.slots += stats.slots;
    total.unusedSlots += stats.unusedSlots;
    for (const [kind, count] of Object.entries(stats.slotsByKind)) {
      total.slotsByKind[kind] = (total.slotsByKind[kind] ?? 0) + count;
    }
    for (let index = 0; index < stats.levelCounts.length; index += 1) {
      total.levelCounts[index] =
        (total.levelCounts[index] ?? 0) + stats.levelCounts[index];
    }
  }
  return total;
}
