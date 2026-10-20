import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastValue | null>(null);
let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "success") => {
      const id = ++counter;
      setItems((current) => [...current.slice(-2), { id, message, type }]);
      const timer = setTimeout(() => dismiss(id), 2000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => {
          const Icon =
            item.type === "success" ? CheckCircle2 : item.type === "error" ? AlertCircle : Info;
          return (
            <div key={item.id} className={`toast toast-${item.type}`}>
              <Icon size={18} />
              <span>{item.message}</span>
              <button type="button" onClick={() => dismiss(item.id)} aria-label="关闭">
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}
