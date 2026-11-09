import { prisma } from "../src/core/prisma";

// Crea las 4 tablas de la portada publica (modulo "inicio") y la fila unica de configuracion.
// Idempotente: se puede correr mas de una vez sin duplicar nada.
// Uso:  npx tsx scripts/create_landing_tables.ts

const TABLAS: Record<string, string> = {
  landing_fondos: `
CREATE TABLE IF NOT EXISTS landing_fondos (
  id_landing_fondo INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vc_tipo          VARCHAR(10)  NOT NULL,
  vc_url           VARCHAR(500) NOT NULL,
  vc_bucket_path   VARCHAR(500) NOT NULL,
  i_order          INT          NOT NULL DEFAULT 0,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  dt_register      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_landing_fondos_order (is_active, i_order)
)`,
  landing_personajes: `
CREATE TABLE IF NOT EXISTS landing_personajes (
  id_landing_personaje INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vc_nombre            VARCHAR(100) NULL,
  vc_puesto            VARCHAR(100) NULL,
  vc_url               VARCHAR(500) NOT NULL,
  vc_bucket_path       VARCHAR(500) NOT NULL,
  i_order              INT          NOT NULL DEFAULT 0,
  is_active            TINYINT(1)   NOT NULL DEFAULT 1,
  dt_register          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_landing_personajes_order (is_active, i_order)
)`,
  landing_clientes: `
CREATE TABLE IF NOT EXISTS landing_clientes (
  id_landing_cliente INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vc_nombre          VARCHAR(150) NOT NULL,
  vc_tipo            VARCHAR(10)  NOT NULL,
  vc_url             VARCHAR(500) NOT NULL,
  vc_bucket_path     VARCHAR(500) NOT NULL,
  vc_enlace          VARCHAR(500) NULL,
  i_order            INT          NOT NULL DEFAULT 0,
  is_active          TINYINT(1)   NOT NULL DEFAULT 1,
  dt_register        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_landing_clientes_order (is_active, i_order)
)`,
  landing_config: `
CREATE TABLE IF NOT EXISTS landing_config (
  id_landing_config INT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  vc_titulo         VARCHAR(200) NULL,
  vc_telefono       VARCHAR(30)  NULL,
  vc_whatsapp       VARCHAR(30)  NULL,
  vc_correo         VARCHAR(150) NULL,
  vc_direccion      VARCHAR(300) NULL,
  vc_horario        VARCHAR(200) NULL,
  vc_sitio_web      VARCHAR(300) NULL,
  vc_instagram_url  VARCHAR(300) NULL,
  vc_facebook_url   VARCHAR(300) NULL,
  vc_tiktok_url     VARCHAR(300) NULL,
  vc_youtube_url    VARCHAR(300) NULL,
  vc_x_url          VARCHAR(300) NULL,
  vc_linkedin_url   VARCHAR(300) NULL,
  vc_dev_nombre     VARCHAR(100) NULL,
  vc_dev_whatsapp   VARCHAR(30)  NULL,
  dt_update         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`,
};

async function main() {
  for (const [nombre, sql] of Object.entries(TABLAS)) {
    await prisma.$executeRawUnsafe(sql);
    console.log(`tabla ${nombre}: ok`);
  }

  // Fila unica de configuracion (si ya existe no se toca).
  await prisma.$executeRawUnsafe("INSERT IGNORE INTO landing_config (id_landing_config) VALUES (1)");

  const rows = await prisma.$queryRawUnsafe<{ c: number }[]>(
    `SELECT COUNT(*) AS c FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name IN (${Object.keys(TABLAS).map((t) => `'${t}'`).join(",")})`,
  );
  console.log("tablas de portada presentes:", Number(rows[0]?.c), "de", Object.keys(TABLAS).length);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
