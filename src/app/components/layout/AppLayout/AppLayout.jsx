
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import "./AppLayout.css";

import Sidebar from "../Sidebar";
import Header from "../Header";

export default function AppLayout({ children }) {
  return (
    <LocalizedElement as="div" className="app-layout">

      <Sidebar />

      <LocalizedElement as="div" className="app-main">

        <Header />

        <LocalizedElement as="main" className="app-content">
          {children}
        </LocalizedElement>

      </LocalizedElement>

    </LocalizedElement>
  );
}