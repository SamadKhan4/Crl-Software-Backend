const round = (value) => Math.round(value * 1000000) / 1000000;

export function calculateGoods(goods = []) {
  const rows = goods.map((value) => {
    const item = value.toObject?.() ?? value;
    const volume = Number(item.length || 0) * Number(item.breadth || 0) * Number(item.height || 0)
      * Number(item.quantity || 0) / ({ CM: 27000, IN: 1728, FT: 1 }[item.dimensionUnit] || 27000);
    const actualWeight = Number(item.actualWeight || 0);
    return { ...item, volume, volumetricWeight: volume * 7, chargedWeight: Math.max(actualWeight, volume * 7) };
  });
  const sum = (key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const actualWeight = sum('actualWeight'), volume = sum('volume'), volumetricWeight = volume * 7;
  return {
    goods: rows.map((row) => ({ ...row, volume: round(row.volume), volumetricWeight: round(row.volumetricWeight), chargedWeight: round(row.chargedWeight) })),
    packageCount: sum('quantity'), actualWeight: round(actualWeight), volume: round(volume),
    volumetricWeight: round(volumetricWeight), chargedWeight: round(Math.max(actualWeight, volumetricWeight)),
    declaredValue: round(sum('declaredValue')),
  };
}
