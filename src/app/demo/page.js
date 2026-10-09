
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import Header from "../components/layout/Header";
import Footer from "../components/layout/Footer";
import DemoClient from "./DemoClient";
import "./demo.css";

export const metadata = {
  title: "Ventra | Product demo",
  description: "A guided product demo of Ventra construction intelligence.",
};

export default function DemoPage() {
  return (
    <>
      <Header />
      <LocalizedElement as="main" className="vt-demo-page">
        <DemoClient />
      </LocalizedElement>
      <Footer />
    </>
  );
}
