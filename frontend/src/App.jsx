import { useState } from "react";
import UploadPage from "./pages/UploadPage";
import EditPage from "./pages/EditPage";

export default function App() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [page, setPage] = useState("upload");

  // Upload page state
  const [condition, setCondition] = useState("model_based");
  const [images, setImages] = useState([]); // [{imageId, url, file}]

  // Edit page state
  const [candidates, setCandidates] = useState([]);

  function handleUploaded(uploadedImages, selectedCondition) {
    setImages(uploadedImages);
    setCondition(selectedCondition);
    setPage("edit");
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="px-6 py-4 border-b border-gray-800 flex items-center gap-3">
        <span className="text-xl font-semibold tracking-tight">PhotoTune</span>
        <span className="text-xs text-gray-500 mt-0.5">AI Filter Recommendation</span>
      </header>

      {page === "upload" ? (
        <UploadPage
          sessionId={sessionId}
          onDone={handleUploaded}
          candidates={candidates}
          setCandidates={setCandidates}
        />
      ) : (
        <EditPage
          images={images}
          sessionId={sessionId}
          condition={condition}
          candidates={candidates}
          setCandidates={setCandidates}
          onBack={() => setPage("upload")}
        />
      )}
    </div>
  );
}
