VSIX_FILE=$(find out/ -name "*.vsix")
artifact push workflow ${VSIX_FILE} --destination packaged-vsix-files/$(basename ${VSIX_FILE})
