import { useEffect, useState } from "react";

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }

  return data;
}

export default function App() {
  const [uploads, setUploads] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadUploads() {
    const data = await request("/api/uploads");
    setUploads(data);
  }

  useEffect(() => {
  let ignore = false;

  request("/api/uploads")
    .then((data) => {
      if (!ignore) {
        setUploads(data);
      }
    })
    .catch((error) => {
      if (!ignore) {
        setMessage(error.message);
      }
    });

  return () => {
    ignore = true;
  };
}, []);;

  async function handleUpload(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    setBusy(true);
    setMessage("");

    try {
      await request("/api/uploads", {
        method: "POST",
        body: formData,
      });

      form.reset();
      setMessage("Файл загружен в S3, метаданные сохранены в RDS.");

      try {
        await loadUploads();
      } catch {
        setMessage("Загрузка успешна. Обнови страницу для обновления списка.");
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(id) {
    try {
      const data = await request(`/api/uploads/${id}/download`);
      window.location.assign(data.url);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <main className="container">
      <header>
        <h1>Курсовые работы</h1>
        <p>Файлы — Amazon S3 · Метаданные — RDS PostgreSQL</p>
      </header>

      <section className="card">
        <h2>Загрузить работу</h2>

        <form onSubmit={handleUpload}>
          <label>
            ФИО студента
            <input
              name="student_name"
              placeholder="Abdulaziz Azizov"
              maxLength={150}
              required
            />
          </label>

          <label>
            Группа
            <input
              name="student_group"
              placeholder="Информационные системы"
              maxLength={100}
              required
            />
          </label>

          <label>
            PDF-файл, до 20 МБ
            <input
              type="file"
              name="file"
              accept=".pdf"
              required
            />
          </label>

          <button type="submit" disabled={busy}>
            {busy ? "Загрузка..." : "Загрузить курсовую"}
          </button>
        </form>

        <p className="message" role="status">{message}</p>
      </section>

      <section className="card">
        <h2>Загруженные работы</h2>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Студент</th>
                <th>Группа</th>
                <th>Файл</th>
                <th>Размер</th>
                <th>Дата</th>
                <th>Действие</th>
              </tr>
            </thead>

            <tbody>
              {uploads.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.student_name}</td>
                  <td>{item.student_group}</td>
                  <td>{item.file_name}</td>
                  <td>
                    {item.file_size_bytes == null
                      ? "—"
                      : `${(Number(item.file_size_bytes) / 1024).toFixed(1)} КБ`}
                  </td>
                  <td>
                    {new Date(
                      item.uploaded_at || item.created_at
                    ).toLocaleString("ru-RU")}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => openFile(item.id)}
                    >
                      Открыть
                    </button>
                  </td>
                </tr>
              ))}

              {uploads.length === 0 && (
                <tr>
                  <td colSpan={7}>Список пока пуст.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}