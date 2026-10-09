import WorkspacePage from '../../components/WorkspacePage';import SharedProjectWorkspace from '../../projects/[id]/SharedProjectWorkspace';
export default async function Page({params}){const {id}=await params;return <WorkspacePage title="Project Control"><SharedProjectWorkspace key={id} projectId={id}/></WorkspacePage>}
