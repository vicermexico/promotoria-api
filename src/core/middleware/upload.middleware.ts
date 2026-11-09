import multer from "multer";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes"));
    }
  },
});

export const uploadExcel = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB para Excel
    fileFilter: (_req, file, cb) => {
        const validMimeTypes = [
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
            "application/vnd.ms-excel", // .xls
        ];

        if (validMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Solo se permiten archivos Excel (.xlsx, .xls)"));
        }
    },
});

// Genérico (acepta cualquier archivo)
export const uploadAny = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});

export const uploadVideo = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("video/")) {
            cb(null, true);
        } else {
            cb(new Error("Solo se permiten videos"));
        }
    },
});

// Imagen o video (portada publica: fondos, personajes, clientes)
export const uploadMedia = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
            cb(null, true);
        } else {
            cb(new Error("Solo se permiten imágenes o videos"));
        }
    },
});
