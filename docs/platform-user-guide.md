# MetaDock Platform User Guide

## Overview

MetaDock is a comprehensive platform for bioinformatic analysis. It provides a user-friendly interface to manage bioinformatic tools, build complex analysis workflows, and visualize results. The platform has two distinct user roles: Administrator and Regular User, each with a specific set of permissions and capabilities.

## User roles and access

### Login process

Every user, including administrators, must first have a regular user account. This account is used to establish an SSH connection to the remote server where MetaDock is hosted.

After establishing the connection, the user is presented with a login screen.

- A **Regular User** logs in with their standard user credentials.
- An **Administrator** can choose to log in with their administrator credentials to access administrative functions.

**Important:** An administrator in an admin session cannot access regular user features. To use the Workflow Builder or Visualization Tools, the administrator must log out and log back in as a regular user.

---

## Administrator role

An Administrator is responsible for managing the tools and environment of the MetaDock platform.

### Administrator features

#### 1. Bioinfo Agent

The Bioinfo Agent is an AI-powered assistant available to all users. Administrators can use it for guidance on platform management, tool installation, and other administrative tasks.

#### 2. Install recommended tools

This feature allows administrators to install and manage bioinformatics tools on the server.

- **Batch installation:** Search for and select multiple tools for batch installation.
- **Installation methods:** Choose from Anaconda, Pip, or Git Clone, depending on the tool.
- **Custom paths:** Define custom installation paths for Conda environments and Git repositories.
- **Environment check:** Verify the server environment for compatibility.
- **One-click install:** Install all selected tools to the remote server with a single click.

#### 3. Add new tools

Administrators can add new bioinformatics tools.

- **Upload help file:** Upload the `help.txt` file of a new tool.
- **Parameter extraction:** MetaDock analyzes the help file (regex or LLM) to extract usage and parameters.
- **Tool availability:** Once processed, the new tool appears for all users in the Tools panel and Workflow Builder.

#### 4. Theme toggle

Switch the UI theme between light and dark mode.

#### 5. User profile

Displays User Name, Host, Port, current role (Administrator), and Log out.

---

## Regular user role

A Regular User uses the platform to run bioinformatic analyses.

### Regular user features

#### 1. Bioinfo Agent

The Bioinfo Agent helps with:

- Using MetaDock features.
- Building analysis pipelines.
- Troubleshooting tools and workflows.
- Answering bioinformatics questions from its knowledge of installed tools.

#### 2. Search tools

A search box to find available tools. Clicking a result opens the tool’s interface.

#### 3. Bioinformatic tools

List of all analysis tools. Selecting a tool opens its interface to configure parameters, set input files, and run.

#### 4. Workflow Builder

Drag-and-drop module for creating and running analysis pipelines.

- **Component panel:** Search and add tools, file inputs/outputs, and visualization nodes. Outputs of one tool can connect to inputs of another.
- **Workflow controls:** Run Workflow, Clear, Save Workflow, Load Workflow, Export Workflow.

#### 5. Visualization tools

Select a visualization type, provide input files, and set parameters to generate figures.

#### 6. Theme toggle

Switch the UI theme between light and dark mode.

#### 7. User profile

Displays User Name, Host, Port, role (Regular User), and Log out.
