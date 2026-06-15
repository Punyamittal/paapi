import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { getAnswersByProfile, saveAnswer, deleteAnswer } from '@/lib/storage/indexed-db';
import { generateId } from '@/lib/crypto/encryption';
import type { SavedAnswer } from '@/types';

interface SavedAnswersViewProps {
  profileId: string;
}

export function SavedAnswersView({ profileId }: SavedAnswersViewProps) {
  const [answers, setAnswers] = useState<SavedAnswer[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');

  const loadAnswers = useCallback(async () => {
    const data = await getAnswersByProfile(profileId);
    setAnswers(data);
  }, [profileId]);

  useEffect(() => {
    void loadAnswers();
  }, [loadAnswers]);

  const handleCreate = async () => {
    if (!title.trim() || !content.trim()) return;
    const now = Date.now();
    const answer: SavedAnswer = {
      id: generateId(),
      title: title.trim(),
      content: content.trim(),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      profileId,
      createdAt: now,
      updatedAt: now,
    };
    await saveAnswer(answer);
    setTitle('');
    setContent('');
    setTags('');
    setCreating(false);
    await loadAnswers();
  };

  const handleDelete = async (id: string) => {
    await deleteAnswer(id);
    await loadAnswers();
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Saved Answers</h2>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-brand-600 bg-brand-50 rounded-md hover:bg-brand-100"
        >
          <Plus className="w-3 h-3" />
          New
        </button>
      </div>

      {creating && (
        <div className="p-3 bg-slate-50 rounded-lg space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g., Personal Introduction)"
            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Your saved answer..."
            rows={4}
            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md resize-none"
          />
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Tags (comma-separated: intro, leadership, hackathon)"
            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md"
          />
          <button
            onClick={handleCreate}
            className="w-full py-1.5 text-xs font-medium text-white bg-brand-600 rounded-md"
          >
            Save Answer
          </button>
        </div>
      )}

      {answers.length === 0 && !creating ? (
        <div className="text-center py-8 text-slate-400">
          <p className="text-xs">No saved answers yet</p>
          <p className="text-[10px] mt-1">
            Save reusable responses for common form questions
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[360px] overflow-y-auto">
          {answers.map((answer) => (
            <div
              key={answer.id}
              className="p-3 border border-slate-100 rounded-lg hover:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-700">{answer.title}</h3>
                <button
                  onClick={() => handleDelete(answer.id)}
                  className="text-slate-300 hover:text-red-500 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1 line-clamp-3">{answer.content}</p>
              {answer.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {answer.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 text-[10px] bg-brand-50 text-brand-600 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
