import { useEffect, useRef, useState } from 'react';
import { listFiles, uploadFiles, deleteFile, downloadUrl, type RemoteFile } from '../api/files';

function fileIconClass(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg','jpeg','png','gif','webp','svg','bmp','ico'].includes(ext)) return 'file-icon-img';
  if (['mp4','mov','avi','mkv','webm'].includes(ext)) return 'file-icon-video';
  if (['mp3','wav','ogg','flac','aac'].includes(ext)) return 'file-icon-audio';
  if (['pdf','doc','docx','txt','md','xls','xlsx','ppt','pptx'].includes(ext)) return 'file-icon-doc';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return 'file-icon-zip';
  return 'file-icon-other';
}

function FileIcon({ name }: { name: string }) {
  const cls = fileIconClass(name);
  if (cls === 'file-icon-img') return (
    <div className={`file-icon ${cls}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    </div>
  );
  if (cls === 'file-icon-video') return (
    <div className={`file-icon ${cls}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
      </svg>
    </div>
  );
  if (cls === 'file-icon-audio') return (
    <div className={`file-icon ${cls}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
    </div>
  );
  if (cls === 'file-icon-doc') return (
    <div className={`file-icon ${cls}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    </div>
  );
  if (cls === 'file-icon-zip') return (
    <div className={`file-icon ${cls}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      </svg>
    </div>
  );
  return (
    <div className={`file-icon ${cls}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
      </svg>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Files() {
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setFiles(await listFiles());
      setError('');
    } catch {
      setError('Failed to load files');
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleUpload(fileList: FileList) {
    if (!fileList.length) return;
    setUploading(true);
    setUploadProgress(0);
    setError('');
    try {
      await uploadFiles(fileList, setUploadProgress);
      await refresh();
    } catch {
      setError('Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete(fileName: string) {
    try {
      await deleteFile(fileName);
      await refresh();
    } catch {
      setError('Delete failed');
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() { setDragOver(false); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  }

  return (
    <div className="files-panel">
      <div className="files-toolbar">
        <span className="files-toolbar-title">Files</span>
        <button className="btn-upload" onClick={() => inputRef.current?.click()} disabled={uploading}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
          </svg>
          Upload
        </button>
        <button className="btn-refresh" onClick={refresh}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => e.target.files && handleUpload(e.target.files)} />
      </div>

      <div
        className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
        </svg>
        <p>Drop files here or click to upload</p>
        <small>Any file type supported</small>
      </div>

      {uploading && (
        <div className="upload-progress">
          <span>
            {uploadProgress !== null && uploadProgress > 0
              ? `Uploading… ${uploadProgress}%`
              : 'Uploading…'}
          </span>
          <div className="upload-progress-bar">
            <div
              className={`upload-progress-fill${uploadProgress !== null ? ' determinate' : ''}`}
              style={uploadProgress !== null ? { width: `${uploadProgress}%` } : undefined}
            />
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {files.length > 0 && (
        <span className="files-count">{files.length} file{files.length !== 1 ? 's' : ''}</span>
      )}

      <div className="files-list">
        {files.length === 0 && !uploading && (
          <div className="files-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <p>No files yet</p>
          </div>
        )}
        {files.map((file) => (
          <div key={file.name} className="file-item">
            <FileIcon name={file.name} />
            <div className="file-info">
              <span className="file-name">{file.name}</span>
              <span className="file-meta">{formatSize(file.size)} · {formatDate(file.modified)}</span>
            </div>
            <div className="file-actions">
              <a className="btn-download" href={downloadUrl(file.name)} download={file.name}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
                </svg>
                <span>Download</span>
              </a>
              <button className="btn-delete" onClick={() => handleDelete(file.name)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
                <span>Delete</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
