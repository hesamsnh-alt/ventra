
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import Header from "../components/layout/Header";import Toolbox from "../components/Toolbox";import Footer from "../components/layout/Footer";export default function Page(){return <><Header/><LocalizedElement as="main" style={{paddingTop:100}}><Toolbox/></LocalizedElement><Footer/></>}
