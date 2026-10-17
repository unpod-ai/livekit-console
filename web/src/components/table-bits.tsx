import { Empty, SkeletonRows, errText } from './ui';

export { Empty, SkeletonRows };
export const ErrorMsgInline = ({ error }: { error: unknown }) =>
  error ? <div className="alert bad" style={{ margin: 12 }}>{errText(error)}</div> : null;
