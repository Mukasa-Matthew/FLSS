import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const fetchJson = (url, options = {}) =>
  fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
    keepalive: true,
  });

const formatSize = (bytes) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const size = Math.floor(Math.log(bytes) / Math.log(1024));
  const scaled = bytes / 1024 ** size;
  return `${scaled.toFixed(size === 0 ? 0 : 1)} ${units[size]}`;
};

const formatDate = (isoDate) =>
  new Date(isoDate).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatRelativeTime = (isoDate) => {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} min ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} hr ago`;
  return `${Math.floor(diffMs / day)} day ago`;
};

const extFromName = (name) => {
  const ext = name.split(".").pop();
  return ext ? ext.toUpperCase() : "FILE";
};

const DELETE_TOKEN_STORAGE_KEY = "uploadDeleteTokens";

function App() {
  const fileInputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [pendingFile, setPendingFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [downloadFile, setDownloadFile] = useState(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [deleteTokenByFileId, setDeleteTokenByFileId] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(DELETE_TOKEN_STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  });

  const totalStorage = useMemo(
    () => files.reduce((sum, file) => sum + Number(file.size_bytes), 0),
    [files]
  );

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchJson(`${API_BASE_URL}/api/files`);
      if (!response.ok) throw new Error("Could not load files.");
      const data = await response.json();
      setFiles(data);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    localStorage.setItem(
      DELETE_TOKEN_STORAGE_KEY,
      JSON.stringify(deleteTokenByFileId)
    );
  }, [deleteTokenByFileId]);

  const onPickFile = (event) => {
    setPendingFile(event.target.files?.[0] || null);
    setSuccessMessage("");
    setErrorMessage("");
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!pendingFile) {
      setErrorMessage("Pick a file first.");
      return;
    }

    const body = new FormData();
    body.append("file", pendingFile);

    setUploading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/files/upload`, {
        method: "POST",
        body,
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || "Upload failed.");
      }

      await fetchFiles();
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const uploadedData = await response.json();
      if (uploadedData.id && uploadedData.delete_token) {
        setDeleteTokenByFileId((prev) => ({
          ...prev,
          [uploadedData.id]: {
            token: uploadedData.delete_token,
            expiresAt: uploadedData.delete_expires_at,
          },
        }));
      }
      setSuccessMessage("Upload complete.");
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setUploading(false);
    }
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const canDeleteFile = (fileId) => {
    const info = deleteTokenByFileId[fileId];
    if (!info?.token || !info?.expiresAt) return false;
    return new Date(info.expiresAt).getTime() > Date.now();
  };

  const handleDeleteFile = async (file) => {
    const tokenInfo = deleteTokenByFileId[file.id];
    if (!tokenInfo?.token) {
      setErrorMessage("Only the uploader can delete this file.");
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/files/${file.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deleteToken: tokenInfo.token }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || "Delete failed.");
      }

      setDeleteTokenByFileId((prev) => {
        const next = { ...prev };
        delete next[file.id];
        return next;
      });
      await fetchFiles();
      setSuccessMessage("File deleted by uploader.");
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const handleDownload = async (file, password) => {
    setErrorMessage("");
    setDownloadError("");
    setSuccessMessage("");
    setDownloading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/files/${file.id}/download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
        keepalive: true,
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || "Download failed.");
      }
      const downloaderUser =
        response.headers.get("X-Downloader-User") ||
        response.headers.get("x-downloader-user") ||
        "User";

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = file.original_name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);

      setSuccessMessage(`Downloading, ${downloaderUser}`);
      setDownloadFile(null);
      setPasswordInput("");
      await fetchFiles();
    } catch (error) {
      setDownloadError(error.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="panel">
        <article className="upload-pane">
          <p className="section-title">Upload</p>
          <div className="drop-zone">
            <div className="upload-icon">↑</div>
            <h1>Drop your file here</h1>
            <p>Drag and drop to upload, or choose a file from your device.</p>

            <button type="button" className="browse-btn" onClick={openFilePicker}>
              Browse files
            </button>

            <form onSubmit={handleUpload}>
              <input
                id="file"
                ref={fileInputRef}
                type="file"
                onChange={onPickFile}
                required
                className="native-input"
              />

              <div className="chip-row">
                <span>PDF</span>
                <span>DOCX</span>
                <span>XLSX</span>
                <span>TXT</span>
                <span>CSV</span>
                <span>PPTX</span>
              </div>

              {pendingFile ? (
                <div className="pending-row">
                  <p>
                    Ready: {pendingFile.name} ({formatSize(pendingFile.size)})
                  </p>
                  <button disabled={uploading} type="submit" className="upload-btn">
                    {uploading ? "Uploading..." : "Upload"}
                  </button>
                </div>
              ) : null}
            </form>
          </div>
          {errorMessage ? <p className="error">{errorMessage}</p> : null}
        </article>

        <article className="files-pane">
          <p className="section-title">Available files</p>

          <div className="stats">
            <article>
              <strong>{files.length}</strong>
              <span>Files shared</span>
            </article>
            <article>
              <strong>{formatSize(totalStorage)}</strong>
              <span>Total size</span>
            </article>
          </div>

          {loading ? <p className="muted">Loading files...</p> : null}
          {!loading && files.length === 0 ? <p className="muted">No files yet.</p> : null}

          <div className="file-list">
            {files.map((file) => (
              <div className="file-row" key={file.id}>
                <span className="type-pill">{extFromName(file.original_name)}</span>
                <div className="file-meta">
                  <strong>{file.original_name}</strong>
                  <p>
                    {formatSize(Number(file.size_bytes))} ·{" "}
                    {formatRelativeTime(file.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  className="download-btn"
                  onClick={() => {
                    setDownloadError("");
                    setDownloadFile(file);
                  }}
                  title={`Uploaded ${formatDate(file.created_at)}`}
                >
                  Download
                </button>
                {canDeleteFile(file.id) ? (
                  <button
                    type="button"
                    className="delete-btn"
                    onClick={() => handleDeleteFile(file)}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <button type="button" className="refresh-btn" onClick={fetchFiles}>
            Refresh list
          </button>
        </article>
      </section>

      {downloadFile ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setDownloadFile(null);
            setPasswordInput("");
            setDownloadError("");
          }}
        >
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Password Required</h3>
            <p>Enter your password to download {downloadFile.original_name}.</p>
            {downloadError ? (
              <div className="modal-error" role="alert" aria-live="assertive">
                {downloadError}
              </div>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleDownload(downloadFile, passwordInput);
              }}
            >
              <input
                type="password"
                className={`password-input${downloadError ? " password-input-error" : ""}`}
                value={passwordInput}
                onChange={(event) => {
                  setPasswordInput(event.target.value);
                  setDownloadError("");
                }}
                placeholder="Password"
                required
                autoFocus
              />
              <div className="modal-actions">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setDownloadFile(null);
                    setPasswordInput("");
                    setDownloadError("");
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="upload-btn" disabled={downloading}>
                  {downloading ? "Checking..." : "Download"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {successMessage ? (
        <p className="success-toast" role="status" aria-live="polite">
          {successMessage}
        </p>
      ) : null}
    </main>
  );
}

export default App;
