import { type ChangeEvent, type DragEvent, useRef, useState } from 'react';
import { Button, Field } from '../atoms/index.js';
import { CmsApiError } from '../client.js';
import { useCms } from '../context.js';
import type { FieldComponentProps } from '../registry.js';
import { fieldTitle } from '../registry.js';
import type { CmsUpload } from '../types.js';
import { RelationPicker } from './relation-picker.js';

function asAsset(value: unknown): Partial<CmsUpload> | null {
  if (!value) return null;
  if (typeof value === 'string') return { id: value };
  if (typeof value === 'object') return value as Partial<CmsUpload>;
  return null;
}

function fileLabel(asset: Partial<CmsUpload>): string {
  if (asset.filename) return asset.filename;
  if (asset.url) {
    const name = asset.url.split('/').pop() ?? asset.url;
    return decodeURIComponent(name);
  }
  return asset.id ?? 'file';
}

/**
 * `upload` field, vendored the Payload way: a dashed dropzone that accepts a dropped file (or a
 * click), then a card with the asset, its size/dimensions and remove/replace actions.
 *
 * The uploader is injected through `CmsProvider upload`; without it the field degrades to the
 * relation picker, which is what this field was before the dropzone existed.
 */
export function UploadField({ field, value, onChange, error, id, disabled }: FieldComponentProps) {
  const { upload } = useCms();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [browse, setBrowse] = useState(false);
  // The form stores only the id; the asset the endpoint just returned is kept for the card so a
  // fresh upload shows its name and mime without a second round trip.
  const [justUploaded, setJustUploaded] = useState<CmsUpload | null>(null);

  const raw = asAsset(value);
  const asset = raw && justUploaded && raw.id === justUploaded.id ? justUploaded : raw;

  if (!upload) {
    return <RelationPicker field={field} value={value} onChange={onChange} id={id} />;
  }

  const send = async (file: File) => {
    setBusy(true);
    setFailure(null);
    try {
      const stored = await upload(file, { field: field.name });
      setJustUploaded(stored);
      onChange(stored.id);
    } catch (cause) {
      setFailure(
        cause instanceof CmsApiError && cause.status === 404
          ? 'This app has no upload endpoint: set `cms.uploads.handler`.'
          : cause instanceof Error
            ? cause.message
            : 'upload failed',
      );
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !disabled) void send(file);
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void send(file);
    event.target.value = '';
  };

  return (
    <Field
      label={fieldTitle(field)}
      description={field.admin?.description}
      error={error ?? failure ?? undefined}
      required={field.required}
      htmlFor={id}
    >
      {asset?.id && !browse ? (
        <div className="upload-card">
          <div className="upload-card__thumb">
            {asset.url ? (
              <img
                src={asset.url}
                alt=""
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            ) : null}
            <span className="upload-card__ext">
              {(asset.mime ?? 'file').split('/').pop()?.toUpperCase()}
            </span>
          </div>
          <div className="upload-card__meta">
            <strong>{fileLabel(asset)}</strong>
            <span>
              {[asset.mime, asset.width && asset.height ? `${asset.width}×${asset.height}` : null]
                .filter(Boolean)
                .join(' · ') || 'stored file'}
            </span>
          </div>
          <div className="upload-card__actions">
            <Button size="xs" onClick={() => inputRef.current?.click()} disabled={disabled || busy}>
              {busy ? 'Uploading…' : 'Replace'}
            </Button>
            <Button
              size="xs"
              tone="ghost"
              onClick={() => setBrowse(true)}
              disabled={disabled || busy}
            >
              Pick existing
            </Button>
            <Button size="xs" tone="destructive" onClick={() => onChange(null)} disabled={disabled}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className={`upload-drop${dragging ? ' upload-drop--over' : ''}${
              disabled ? ' upload-drop--off' : ''
            }`}
            aria-label={`Upload ${field.name}`}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (!disabled) inputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (!disabled) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <strong>{busy ? 'Uploading…' : 'Drop a file here'}</strong>
            <span>or click to browse</span>
          </button>
          {browse ? (
            <Button size="xs" tone="ghost" onClick={() => setBrowse(false)}>
              Back to dropzone
            </Button>
          ) : null}
          {browse ? (
            <RelationPicker field={field} value={value} onChange={onChange} id={id} />
          ) : null}
        </>
      )}

      <input
        ref={inputRef}
        id={id}
        type="file"
        hidden
        onChange={onPick}
        accept={field.mimeTypes?.join(',')}
      />
    </Field>
  );
}
