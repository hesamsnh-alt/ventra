
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import Header from "./layout/Header";
import Footer from "./layout/Footer";
export default function WorkspacePage({title,children}){return <><Header/><LocalizedElement as="main" style={{maxWidth:1000,margin:"auto",padding:"130px 24px 70px",minHeight:"65vh",lineHeight:1.8}}><LocalizedElement as="h1">{title}</LocalizedElement>{children}</LocalizedElement><Footer/></>}
