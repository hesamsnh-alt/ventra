import "./Header.css";

import {

Search,

Bell,

CircleUserRound

} from "lucide-react";

export default function Header(){

    return(

        <header className="header">

            <div className="search-box">

                <Search size={18}/>

                <input

                placeholder="Search projects..."

                />

            </div>

            <div className="header-right">

                <Bell size={20}/>

                <CircleUserRound size={34}/>

            </div>

        </header>

    )

}