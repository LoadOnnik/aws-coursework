require("dotenv").config();

const express = require("express");
const multer = require("multer");
const { Pool } = require("pg");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();

const bucket = process.env.S3_BUCKET;

const s3 = new S3Client({
  region: process.env.AWS_REGION,
});

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    ca: fs.readFileSync(process.env.DB_SSL_CA, "utf8"),
    rejectUnauthorized: true,
  },
  connectionTimeoutMillis: 10000,
});

pool.on("error", (error) => {
  console.error("Ошибка фонового подключения PostgreSQL:", error.message);
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
    fields: 2,
  },
});

app.get("/api/health", async (req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/uploads", async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        id, student_name, student_group, file_name,
        file_size_bytes, content_type, uploaded_at, created_at
      FROM coursework_uploads
      ORDER BY id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/uploads", upload.single("file"), async (req, res, next) => {
  const studentName = String(req.body.student_name || "").trim();
  const studentGroup = String(req.body.student_group || "").trim();

  if (!studentName || !studentGroup || !req.file) {
    return res.status(400).json({
      error: "Укажи имя студента, группу и выбери файл.",
    });
  }

  if (studentName.length > 150 || studentGroup.length > 100) {
    return res.status(400).json({
      error: "Слишком длинное имя или название группы.",
    });
  }

  const fileName = req.file.originalname;

  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return res.status(400).json({
      error: "В этой версии разрешены только PDF-файлы.",
    });
  }

  if (fileName.length > 255) {
    return res.status(400).json({
      error: "Имя файла должно быть не длиннее 255 символов.",
    });
  }

  const key = `kursovie/${randomUUID()}.pdf`;
  let objectUploaded = false;

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: "application/pdf",
      })
    );

    objectUploaded = true;

    const result = await pool.query(
      `
        INSERT INTO coursework_uploads (
          student_name, student_group, file_name,
          s3_bucket, s3_key, file_size_bytes,
          content_type, uploaded_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        RETURNING *
      `,
      [
        studentName,
        studentGroup,
        fileName,
        bucket,
        key,
        req.file.size,
        "application/pdf",
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    // При неоднозначном результате запроса проверяем наличие записи.
    if (objectUploaded) {
      try {
        const existing = await pool.query(
          "SELECT * FROM coursework_uploads WHERE s3_key = $1",
          [key]
        );

        if (existing.rows.length) {
          return res.status(201).json(existing.rows[0]);
        }

        await s3.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        );
      } catch (cleanupError) {
        console.error(
          "Нужно проверить объект вручную:",
          key,
          cleanupError.message
        );
      }
    }

    next(error);
  }
});

app.get("/api/uploads/:id/download", async (req, res, next) => {
  try {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
      return res.status(400).json({ error: "Некорректный ID." });
    }

    const result = await pool.query(
      "SELECT s3_bucket, s3_key FROM coursework_uploads WHERE id = $1",
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Запись не найдена." });
    }

    const row = result.rows[0];

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: row.s3_bucket,
        Key: row.s3_key,
      }),
      { expiresIn: 300 }
    );

    res.json({ url });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "Максимальный размер файла — 20 МБ."
          : "Ошибка формы загрузки.",
    });
  }

  res.status(500).json({
    error: "Ошибка сервера. Подробности смотри в терминале Node.js.",
  });
});

const port = Number(process.env.PORT || 3001);

app.listen(port, "127.0.0.1", () => {
  console.log(`API запущен: http://127.0.0.1:${port}`);
});