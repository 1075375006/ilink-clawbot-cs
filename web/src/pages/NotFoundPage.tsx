import { Link } from "react-router-dom";
import { Compass } from "lucide-react";

export function NotFoundPage() {
  return (
    <div className="not-found">
      <span className="not-found-icon">
        <Compass size={30} />
      </span>
      <h1>页面走丢了</h1>
      <p>你访问的页面不存在，或者已经被移动。</p>
      <Link className="btn btn-primary" to="/">
        回到仪表盘
      </Link>
    </div>
  );
}
