## Configuring Tools in the MetaDock Frontend

To allow regular users to run tools through MetaDock, an administrator must first set up a user-friendly parameter selection interface. MetaDock can automatically convert a CLI help page into a graphical interface.

### Steps

1. **Log in as an Administrator**

2. **Upload the Tool's Help Page**

3. **Register the Tool in MetaDock**

    Edit the `config/tools.js` file and add a new entry in the `"env"` section for your tool. Use the following template:

    ```json
    "metaphlan": {
      // ... other configuration fields ...
      "env": "bash -l -c \"source ${CONDA_PREFIX}/etc/profile.d/conda.sh; conda activate metaphlan-4.1.1; __COMMAND__\""
      // ... other configuration fields ...
    }
    ```

    Other fields can be left as they are unless customized configuration is needed.

    To find the path to `${CONDA_PREFIX}/etc/profile.d/conda.sh`, run:

    ```bash
    ls $(conda info --base)/etc/profile.d/conda.sh
    ```

4. **Test the Tool**

    After registration, verify that the tool appears in the MetaDock interface and functions as expected.