# MetaDock Platform Guide

## Overview

MetaDock is a comprehensive platform for bioinformatic analysis. It provides a user-friendly interface to manage bioinformatic tools, build complex analysis workflows, and visualize results. The platform has two distinct user roles: Administrator and Regular User, each with a specific set of permissions and capabilities.

## User Roles and Access

### Login Process

Every user, including administrators, must first have a regular user account. This account is used to establish an SSH connection to the remote server where MetaDock is hosted.

After establishing the connection, the user is presented with a login screen.
- A **Regular User** logs in with their standard user credentials.
- An **Administrator** can choose to log in with their administrator credentials to access administrative functions.

**Important Note:** An administrator logged into an admin session cannot access regular user features. To use features like the Workflow Builder or Visualization Tools, the administrator must log out and log back in as a regular user.

---

## Administrator Role

An Administrator is responsible for managing the tools and environment of the MetaDock platform.

### Administrator Features

#### 1. Bioinfo Agent
The Bioinfo Agent is an AI-powered assistant available to all users. Administrators can use it for guidance on platform management, tool installation, and other administrative tasks.

#### 2. Install Recommended Tools
This feature allows administrators to easily install and manage bioinformatics tools on the server.
- **Batch Installation:** Search for and select multiple tools for batch installation.
- **Installation Methods:** Choose from various installation methods offered by MetaDock, such as Anaconda, Pip, or Git Clone, depending on the tool.
- **Custom Paths:** Define custom installation paths for Conda environments and Git repositories.
- **Environment Check:** Verify the server environment to ensure compatibility and successful installations.
- **One-Click Download:** Install all selected tools to the remote server with a single click.

#### 3. Add New Tools
Administrators can extend the platform's capabilities by adding new bioinformatics tools.
- **Upload Help File:** Upload the `help.txt` file of a new tool.
- **Parameter Extraction:** MetaDock automatically analyzes the help file using regular expressions or an LLM to extract the tool's usage instructions and parameters.
- **Tool Availability:** Once processed, the new tool becomes available for all regular users in the "Tools" panel and "Workflow Builder".

#### 4. Theme Toggle
Administrators can switch the user interface theme between light (☀️) and dark (🌙) modes for their preference.

#### 5. User Profile
The user profile section displays essential information about the current session, including User Name, Host, Port, and current role (Administrator). It also contains the "Log out" option.

---

## Regular User Role

A Regular User leverages the MetaDock platform to perform bioinformatic analyses.

### Regular User Features

#### 1. Bioinfo Agent
The Bioinfo Agent acts as a personal assistant for regular users. It can help with:
- Understanding how to use different MetaDock features.
- Building analysis pipelines.
- Troubleshooting issues with tools and workflows.
- Answering general bioinformatics questions based on its knowledge of installed tools.

#### 2. Search Tools
A dedicated search box to quickly find available bioinformatics tools on the platform. Clicking on a tool from the search results redirects the user to the tool's specific interface.

#### 3. Bioinformatic Tools
This panel lists all the analysis tools available on the platform. Selecting a tool opens its interface, where users can configure parameters, specify input files, and run the tool.

#### 4. Workflow Builder
A powerful module for creating, managing, and running complex analysis pipelines using a drag-and-drop interface.
- **Component Panel:**
    - **Search Components:** Quickly find tools, file handlers, and visualization modules to add to your workflow.
    - **File Components:**
        - `Local File Input`: Upload files from your local computer.
        - `Server File Input`: Use files already present on the server.
        - `Local Folder Output`: Download results to your local computer.
        - `Server Folder Output`: Save results to a specified directory on the server.
    - **Tools:** Drag and drop any available bioinformatic tool into the workflow canvas. Outputs from one tool can be piped as inputs to another.
    - **Visualisation:** Add visualization nodes to the end of a pipeline to generate plots and figures from the final results (e.g., plotting alpha diversity).
- **Workflow Controls:**
    - `Run Workflow`: Execute the entire pipeline.
    - `Clear`: Delete the current workflow from the canvas.
    - `Save Workflow`: Save the current pipeline for future use.
    - `Load Workflow`: Import a previously saved workflow.
    - `Export Workflow`: Export the workflow design.

#### 5. Visualization Tools
This module provides various visualization options for analyzing and presenting data. Users can select a visualization type, provide input files, and customize parameters to generate figures.

#### 6. Theme Toggle
Regular users can switch the user interface theme between light (☀️) and dark (🌙) modes.

#### 7. User Profile
The user profile section displays information about the current session: User Name, Host, Port, and current role (Regular User). It also contains the "Log out" option.
