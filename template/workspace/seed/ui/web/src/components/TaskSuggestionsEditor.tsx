import { useEffect, useState, type ChangeEvent } from "react";
import type { SuggestedTask } from "@shared/types";

type Props = {
  tasks: SuggestedTask[];
  onChange: (tasks: SuggestedTask[]) => void;
  onAccept: () => void;
};

export default function TaskSuggestionsEditor({ tasks, onChange, onAccept }: Props) {
  const [localTasks, setLocalTasks] = useState<SuggestedTask[]>(tasks);

  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  const sync = (next: SuggestedTask[]) => {
    setLocalTasks(next);
    onChange(next);
  };

  const updateTitle = (index: number, title: string) => {
    const next = [...localTasks];
    next[index] = { ...next[index], title };
    sync(next);
  };

  const addTask = () => {
    sync([...localTasks, { title: "New task" }]);
  };

  const removeTask = (index: number) => {
    sync(localTasks.filter((_: SuggestedTask, i: number) => i !== index));
  };

  return (
    <div className="task-editor">
      <h2>Suggested tasks</h2>
      <p>Edit these tasks before accepting them.</p>
      <div className="task-list">
        {localTasks.map((task: SuggestedTask, index: number) => (
          <div key={`${task.title}-${index}`} className="task-row">
            <input
              value={task.title}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateTitle(index, event.target.value)
              }
            />
            <button type="button" onClick={() => removeTask(index)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="task-actions">
        <button type="button" onClick={addTask}>
          Add task
        </button>
        <button type="button" onClick={onAccept}>
          Accept tasks
        </button>
      </div>
    </div>
  );
}
