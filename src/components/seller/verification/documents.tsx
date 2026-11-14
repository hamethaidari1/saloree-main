import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Lock, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_LABEL,
  documentFileProblem,
  formatBytes,
  MAX_DOCUMENTS,
  requiredDocuments,
  type DocumentKind,
  type SellerType,
} from "@/lib/seller-verification";
import {
  errorText,
  openDocument,
  sellerVerificationService,
  verificationKeys,
  type SellerDocument,
} from "@/services/seller-verification";

const SHOWN_KINDS: Record<SellerType | "", DocumentKind[]> = {
  individual: ["id_document", "id_document_back", "proof_of_address"],
  business: ["id_document", "id_document_back", "company_registration", "proof_of_address"],
  "": ["id_document", "id_document_back", "proof_of_address"],
};

const HINT: Partial<Record<DocumentKind, string>> = {
  id_document:
    "The ID you entered in the Identity step (for a business: the representative's ID). The page with your photo.",
  id_document_back: "Only if your ID has information on the back.",
  company_registration: "An extract from the trade register showing the company and its number.",
  proof_of_address: "A recent utility bill or bank statement with your name and address.",
};

interface Pending {
  key: string;
  kind: DocumentKind;
  name: string;
  error: string | null;
}

function KindUpload({
  kind,
  required,
  docs,
  total,
  editable,
  userId,
}: {
  kind: DocumentKind;
  required: boolean;
  docs: SellerDocument[];
  total: number;
  editable: boolean;
  userId: string;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: verificationKeys.documents(userId) });

  const upload = async (files: FileList | File[]) => {
    setMessage(null);
    let count = total + pending.filter((p) => !p.error).length;
    for (const file of Array.from(files)) {
      const problem = documentFileProblem(file, count);
      const key = `${file.name}-${file.size}-${Math.random()}`;
      if (problem) {
        setPending((p) => [...p, { key, kind, name: file.name, error: problem }]);
        continue;
      }
      count++;
      setPending((p) => [...p, { key, kind, name: file.name, error: null }]);
      try {
        await sellerVerificationService.uploadDocument(kind, file, count - 1);
        setPending((p) => p.filter((x) => x.key !== key));
        await refresh();
      } catch (e) {
        count--;
        setPending((p) => p.map((x) => (x.key === key ? { ...x, error: errorText(e) } : x)));
      }
    }
  };

  const remove = async (doc: SellerDocument) => {
    setMessage(null);
    try {
      await sellerVerificationService.deleteDocument(doc);
      await refresh();
    } catch (e) {
      setMessage(errorText(e));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (editable && e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  };
  const inputId = `doc-${kind}`;

  return (
    <section className="verify-doc" aria-labelledby={`${inputId}-title`}>
      <h3 id={`${inputId}-title`} className="verify-doc-title">
        {DOCUMENT_LABEL[kind]}
        <span className={required ? "verify-required" : "verify-optional"}>
          {required ? " (required)" : " (optional)"}
        </span>
      </h3>
      {HINT[kind] && <p className="seller-hint">{HINT[kind]}</p>}

      {docs.length > 0 && (
        <ul className="verify-files" aria-label={`Uploaded: ${DOCUMENT_LABEL[kind]}`}>
          {docs.map((d) => (
            <li key={d.id}>
              <FileText size={16} aria-hidden />
              <span className="verify-file-name" dir="ltr">
                {d.file_name}
              </span>
              <span className="seller-hint">{formatBytes(d.size_bytes)}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void openDocument(d.path, setMessage)}
              >
                View
              </Button>
              {editable && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${d.file_name}`}
                  onClick={() => void remove(d)}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <ul className="verify-files">
          {pending.map((p) => (
            <li key={p.key} data-state={p.error ? "error" : "uploading"}>
              <span className="verify-file-name" dir="ltr">
                {p.name}
              </span>
              {p.error ? (
                <>
                  <span className="seller-error" role="alert">
                    {p.error}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setPending((all) => all.filter((x) => x.key !== p.key))}
                  >
                    Dismiss
                  </Button>
                </>
              ) : (
                <span
                  className="verify-progress"
                  role="progressbar"
                  aria-label={`Uploading ${p.name}`}
                >
                  <span />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div
          className="verify-drop"
          data-dragging={dragging}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Upload aria-hidden />
          <p>Drag a file here, or</p>
          <input
            ref={input}
            id={inputId}
            type="file"
            className="sr-only"
            accept={DOCUMENT_ACCEPT}
            multiple
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
            Choose file
            <span className="sr-only"> for {DOCUMENT_LABEL[kind]}</span>
          </Button>
          <p className="seller-hint">PDF, JPG or PNG, up to 5 MB.</p>
        </div>
      )}
      {message && (
        <p className="seller-error" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}

/** Step 6: upload, list and remove documents. */
export function DocumentsStep({
  userId,
  sellerType,
  documents,
  editable,
  missing,
}: {
  userId: string;
  sellerType: SellerType | "";
  documents: SellerDocument[];
  editable: boolean;
  missing: DocumentKind[];
}) {
  const required = requiredDocuments(sellerType);
  return (
    <div className="grid gap-5">
      <p className="verify-private">
        <Lock size={16} aria-hidden />
        Your files are private. Only you and Saloree staff can open them, and each link works for
        one minute.
      </p>
      <p className="seller-hint">
        {documents.length} of {MAX_DOCUMENTS} files uploaded.
      </p>
      {SHOWN_KINDS[sellerType].map((kind) => (
        <KindUpload
          key={kind}
          kind={kind}
          required={required.includes(kind)}
          docs={documents.filter((d) => d.kind === kind)}
          total={documents.length}
          editable={editable}
          userId={userId}
        />
      ))}
      {missing.length > 0 && (
        <p className="seller-error" role="alert">
          Still needed: {missing.map((k) => DOCUMENT_LABEL[k]).join(", ")}.
        </p>
      )}
    </div>
  );
}
