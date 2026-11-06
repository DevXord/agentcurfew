# Security policy

agentcurfew is a security tool: a policy that is not enforced while agentcurfew says it is, a way to make it read or write files outside the repository it checks, text from a project file that can take over the terminal, or — the hardest rule of this project — causing agentcurfew to execute any scanned component (a skill script, an MCP server, a hook) all count as vulnerabilities.

## Supported versions

| Version | Security fixes |
| --- | --- |
| latest 1.x release | yes |
| older releases | no; update to the latest 1.x |

## Reporting a vulnerability

Please do not report a vulnerability in a public issue, pull request or discussion.

Report it privately on GitHub: open the **Security** tab of [DevXord/agentcurfew](https://github.com/DevXord/agentcurfew), choose **Report a vulnerability** and fill in the form ([direct link](https://github.com/DevXord/agentcurfew/security/advisories/new)). Only you and the maintainers can see the report. If the button is not there, open an issue that asks for a private way to report a vulnerability, without any details.

A useful report says:

- the agentcurfew version (`npx agentcurfew --version`), the Node.js version and the operating system;
- the command, or the GitHub Action inputs, and the smallest project or file that shows the problem;
- what happens and what should happen instead.

A weakness of an AI coding agent itself, such as a setting that does not do what its documentation says, belongs to that project; agentcurfew is affected when it reports such a setting as working.

## What to expect

- A first answer within 7 days, saying whether the report is confirmed.
- Updates while it is being fixed, and a fix in a new 1.x release.
- A GitHub security advisory for the fixed vulnerability, crediting you unless you ask not to be named, with a CVE when one applies.

Please give us time to release the fix before you publish details.
