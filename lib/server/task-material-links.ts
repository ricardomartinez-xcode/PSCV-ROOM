export function uniqueMaterialIds(materialIds: string[]) {
  return [...new Set(materialIds)];
}

export function taskRejectsBucketMaterials(
  itemKind: string | null | undefined,
  taskTypeName: string | null | undefined,
) {
  return itemKind === "event" || taskTypeName?.trim().toLocaleLowerCase("es") === "evento";
}

export function diffTaskMaterialIds(currentIds: string[], desiredIds: string[]) {
  const currentMaterialIds = uniqueMaterialIds(currentIds);
  const materialIds = uniqueMaterialIds(desiredIds);
  const current = new Set(currentMaterialIds);
  const desired = new Set(materialIds);
  const toAdd = materialIds.filter((materialId) => !current.has(materialId));
  const toRemove = currentMaterialIds.filter((materialId) => !desired.has(materialId));

  return {
    materialIds,
    toAdd,
    toRemove,
    changed: toAdd.length > 0 || toRemove.length > 0,
  };
}
