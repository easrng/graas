import { render, h } from "https://esm.sh/preact@10.15.1";
import { useState, useEffect } from "https://esm.sh/preact@10.15.1/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);
const UserCard = ({ user }) => {
  const [responseText, setResponseText] = useState("");
  const setVerified = async (verified) => {
    setResponseText(`setting verified=${verified}`)
    const response = await fetch("/admin/setVerified", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `user=${user.name}&verified=${verified}`,
    });
    setResponseText(await response.text());
  };
  return html`
    <li>
      <h2>${user.name}</h2>
      <p>Images:</p>
      <ul>
        ${user.data.imgs.map(
          (url) => html`<li><img src=${url} alt="User image" /></li>`
        )}
      </ul>
      <p>Code: ${user.data.code}</p>
      <button onClick=${() => setVerified("true")}>Accept</button>
      <button onClick=${() => setVerified("false")}>Reject</button>
      <pre>${responseText}</pre>
    </li>
  `;
};
const AdminDashboard = () => {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    const getUsers = async () => {
      const response = await fetch("/admin/pending");
      const userList = await response.json();
      setUsers(userList);
    };
    getUsers();
  }, []);

  return html`
    <ul>
      ${users.map((user) => html`<${UserCard} user=${user} />`)}
    </ul>
  `;
};

render(html`<${AdminDashboard} />`, document.body);
