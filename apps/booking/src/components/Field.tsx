interface FieldProps {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
}

export function Field({ label, htmlFor, children, required }: FieldProps) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400';
