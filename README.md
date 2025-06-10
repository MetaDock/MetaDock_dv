# MetaDock

1. clone 到本地
2. 在终端运行
   ```shell
   npm install all
   ```
3. 在终端运行
   ```shell
   node server.js
   ```
4. visit [localhost](http://localhost:3010)

```
MetaDock_dv
├─ admin
│  ├─ admin.js
│  ├─ config
│  │  └─ adminConfig.js
│  ├─ controllers
│  │  └─ installerController.js
│  ├─ data
│  │  └─ tools_install.json
│  ├─ routes
│  │  └─ adminRoutes.js
│  ├─ scripts
│  │  ├─ compare_help_html.py
│  │  ├─ json_to_help.py
│  │  └─ param.py
│  ├─ services
│  │  ├─ installationService.js
│  │  └─ toolService.js
│  └─ views
│     ├─ admin-dashboard.ejs
│     ├─ comparison.ejs
│     ├─ index.ejs
│     ├─ installing.ejs
│     ├─ option.ejs
│     ├─ select.ejs
│     ├─ tool-edit.ejs
│     └─ tool-management.ejs
├─ bakta_help.txt
├─ bbmap_help.txt
├─ bowtie2_help.txt
├─ config
│  └─ tools.js
├─ cutadapt.txt
├─ dbcan_help.txt
├─ fastqc_help.txt
├─ gtdb_tk_align_help.txt
├─ handlers
│  └─ commandHandler.js
├─ help
│  ├─ bakta_comparison.html
│  ├─ bakta_generated_help.txt
│  ├─ bakta_help.txt
│  ├─ BBmap_comparison.html
│  ├─ BBmap_generated_help.txt
│  ├─ BBmap_help.txt
│  ├─ Bowtie2_comparison.html
│  ├─ Bowtie2_generated_help.txt
│  ├─ Bowtie2_help.txt
│  ├─ Cutadapt_comparison.html
│  ├─ Cutadapt_generated_help.txt
│  ├─ Cutadapt_help.txt
│  ├─ Dbcan_comparison.html
│  ├─ Dbcan_generated_help.txt
│  ├─ Dbcan_help.txt
│  ├─ FastQC_comparison.html
│  ├─ FastQC_generated_help.txt
│  ├─ FastQC_help.txt
│  ├─ GTDB_TK_Align_comparison.html
│  ├─ GTDB_TK_Align_generated_help.txt
│  ├─ GTDB_TK_Align_help.txt
│  ├─ Metaphlan_comparison.html
│  ├─ Metaphlan_generated_help.txt
│  ├─ Metaphlan_help.txt
│  ├─ MetaSPADES_comparison.html
│  ├─ MetaSPADES_generated_help.txt
│  ├─ MetaSPADES_help.txt
│  ├─ PyANI_comparison.html
│  ├─ PyANI_generated_help.txt
│  └─ PyANI_help.txt
├─ metaphlan.txt
├─ metaspades.py_help.txt
├─ package-lock.json
├─ package.json
├─ parameters
│  ├─ bakta_para.json
│  ├─ bakta_usage.json
│  ├─ bbmap_para.json
│  ├─ bbmap_usage.json
│  ├─ Bowtie2_para.json
│  ├─ Bowtie2_usage.json
│  ├─ cutadapt_para.json
│  ├─ cutadapt_usage.json
│  ├─ Dbcan_para.json
│  ├─ Dbcan_usage.json
│  ├─ FastQC_para.json
│  ├─ FastQC_usage.json
│  ├─ GTDB_TK_Align_para.json
│  ├─ GTDB_TK_Align_usage.json
│  ├─ metaphlan_para.json
│  ├─ metaphlan_usage.json
│  ├─ MetaSPADES_para.json
│  ├─ MetaSPADES_usage.json
│  ├─ PyANI_para.json
│  └─ PyANI_usage.json
├─ public
│  ├─ views
│  │  ├─ bokeh.ejs
│  │  ├─ dashboard.ejs
│  │  ├─ file-browser.ejs
│  │  ├─ login.ejs
│  │  ├─ partials
│  │  │  ├─ footer.ejs
│  │  │  ├─ header.ejs
│  │  │  └─ navbar.ejs
│  │  └─ tool.ejs
│  └─ visualization
│     └─ bokeh_prototype.html
├─ PYANI_help.txt
├─ README.md
├─ server.js
├─ temp
│  ├─ bakta_preview.json
│  ├─ bakta_temp_para.json
│  ├─ bakta_temp_usage.json
│  ├─ FastQC_temp_para.json
│  ├─ FastQC_temp_usage.json
│  ├─ GTDB_TK_Align_temp_para.json
│  └─ GTDB_TK_Align_temp_usage.json
└─ temp_uploads

```
```
MetaDock_dv
├─ admin
│  ├─ admin.js
│  ├─ config
│  │  └─ adminConfig.js
│  ├─ controllers
│  │  └─ installerController.js
│  ├─ data
│  │  └─ tools_install.json
│  ├─ routes
│  │  └─ adminRoutes.js
│  ├─ scripts
│  │  ├─ compare_help_html.py
│  │  ├─ json_to_help.py
│  │  └─ param.py
│  ├─ services
│  │  ├─ installationService.js
│  │  └─ toolService.js
│  └─ views
│     ├─ admin-dashboard.ejs
│     ├─ comparison.ejs
│     ├─ index.ejs
│     ├─ installing.ejs
│     ├─ option.ejs
│     ├─ select.ejs
│     ├─ tool-edit.ejs
│     └─ tool-management.ejs
├─ bakta_help.txt
├─ bbmap_help.txt
├─ bowtie2_help.txt
├─ config
│  └─ tools.js
├─ cutadapt.txt
├─ dbcan_help.txt
├─ fastqc_help.txt
├─ gtdb_tk_align_help.txt
├─ handlers
│  └─ commandHandler.js
├─ help
│  ├─ bakta_comparison.html
│  ├─ bakta_generated_help.txt
│  ├─ bakta_help.txt
│  ├─ BBmap_comparison.html
│  ├─ BBmap_generated_help.txt
│  ├─ BBmap_help.txt
│  ├─ Bowtie2_comparison.html
│  ├─ Bowtie2_generated_help.txt
│  ├─ Bowtie2_help.txt
│  ├─ Cutadapt_comparison.html
│  ├─ Cutadapt_generated_help.txt
│  ├─ Cutadapt_help.txt
│  ├─ Dbcan_comparison.html
│  ├─ Dbcan_generated_help.txt
│  ├─ Dbcan_help.txt
│  ├─ FastQC_comparison.html
│  ├─ FastQC_generated_help.txt
│  ├─ FastQC_help.txt
│  ├─ GTDB_TK_Align_comparison.html
│  ├─ GTDB_TK_Align_generated_help.txt
│  ├─ GTDB_TK_Align_help.txt
│  ├─ Metaphlan_comparison.html
│  ├─ Metaphlan_generated_help.txt
│  ├─ Metaphlan_help.txt
│  ├─ MetaSPADES_comparison.html
│  ├─ MetaSPADES_generated_help.txt
│  ├─ MetaSPADES_help.txt
│  ├─ PyANI_comparison.html
│  ├─ PyANI_generated_help.txt
│  └─ PyANI_help.txt
├─ metaphlan.txt
├─ metaspades.py_help.txt
├─ package-lock.json
├─ package.json
├─ parameters
│  ├─ bakta_para.json
│  ├─ bakta_usage.json
│  ├─ bbmap_para.json
│  ├─ bbmap_usage.json
│  ├─ Bowtie2_para.json
│  ├─ Bowtie2_usage.json
│  ├─ cutadapt_para.json
│  ├─ cutadapt_usage.json
│  ├─ Dbcan_para.json
│  ├─ Dbcan_usage.json
│  ├─ FastQC_para.json
│  ├─ FastQC_usage.json
│  ├─ GTDB_TK_Align_para.json
│  ├─ GTDB_TK_Align_usage.json
│  ├─ metaphlan_para.json
│  ├─ metaphlan_usage.json
│  ├─ MetaSPADES_para.json
│  ├─ MetaSPADES_usage.json
│  ├─ PyANI_para.json
│  └─ PyANI_usage.json
├─ public
│  ├─ views
│  │  ├─ bokeh.ejs
│  │  ├─ dashboard.ejs
│  │  ├─ file-browser.ejs
│  │  ├─ login.ejs
│  │  ├─ partials
│  │  │  ├─ footer.ejs
│  │  │  ├─ header.ejs
│  │  │  └─ navbar.ejs
│  │  └─ tool.ejs
│  └─ visualization
│     └─ bokeh_prototype.html
├─ PYANI_help.txt
├─ README.md
├─ server.js
├─ temp
│  ├─ bakta_preview.json
│  ├─ bakta_temp_para.json
│  ├─ bakta_temp_usage.json
│  ├─ FastQC_temp_para.json
│  ├─ FastQC_temp_usage.json
│  ├─ GTDB_TK_Align_temp_para.json
│  └─ GTDB_TK_Align_temp_usage.json
└─ temp_uploads

```