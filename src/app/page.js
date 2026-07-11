import Header from "./components/layout/Header";
import Hero from "./components/sections/Hero";
import ProjectOverview from "./components/ProjectOverview";
import Workflow from "./components/Workflow";
import Features from "./components/sections/Features";
import Quotation from "./components/sections/Quotation";
import Toolbox from "./components/Toolbox";

export default function Home() {
  return (
    <>
      <Header />

      <main>
        <Hero />
        <ProjectOverview />
        <Workflow />
        <Toolbox />
        <Features />
        <Quotation />
      </main>
    </>
  );
}