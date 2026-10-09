// Presencia de promotores: activo, no dado de baja, con ubicacion reciente.
export const RADIO_PRESENCIA_M = 500
export const VENTANA_PRESENCIA_MIN = 7

export function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export interface PromotorPresente { id: number; name: string; latitude: number; longitude: number }

// prisma se pasa como parametro para no depender de la ruta de import.
export async function promotoresPresentes(prisma: any): Promise<PromotorPresente[]> {
  const desde = new Date(Date.now() - VENTANA_PRESENCIA_MIN * 60 * 1000)
  const rows = await prisma.promoters.findMany({
    where: { isActive: true, dt_deleted: null, latitude: { not: null }, longitude: { not: null }, dt_updated: { gte: desde } },
    select: { id: true, name: true, lastname: true, latitude: true, longitude: true },
  })
  return rows.map((p: any) => ({
    id: p.id,
    name: `${p.name}${p.lastname ? " " + p.lastname : ""}`,
    latitude: Number(p.latitude),
    longitude: Number(p.longitude),
  }))
}

export function mezclarPresentes(activos: any[], presentes: PromotorPresente[], address: any, ocultarNombres: boolean) {
  const mapa = new Map<number, any>()
  for (const a of activos) mapa.set(a.id_promoter, a)
  for (const pr of presentes) {
    if (distM(pr.latitude, pr.longitude, Number(address.latitude), Number(address.longitude)) <= RADIO_PRESENCIA_M) {
      mapa.set(pr.id, { id_promoter: pr.id, name: pr.name, latitude: pr.latitude, longitude: pr.longitude })
    }
  }
  return [...mapa.values()].map((p) => ({ ...p, name: ocultarNombres ? "Promotor " + p.id_promoter : p.name }))
}
