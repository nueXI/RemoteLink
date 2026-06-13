using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using RemoteLink.Api.Options;

namespace RemoteLink.Api.Controllers;

[ApiController]
[Route("api/files")]
public sealed class FilesController(IOptions<RemoteLinkOptions> options) : ControllerBase
{
    private readonly string _uploadPath = Path.GetFullPath(options.Value.UploadPath);

    [HttpGet]
    public IActionResult List()
    {
        var files = Directory.GetFiles(_uploadPath)
            .Select(f => new FileInfo(f))
            .Select(f => new { f.Name, Size = f.Length, Modified = f.LastWriteTimeUtc })
            .OrderByDescending(f => f.Modified);

        return Ok(files);
    }

    [HttpPost("upload")]
    public async Task<IActionResult> Upload()
    {
        if (!Request.HasFormContentType)
            return BadRequest("Expected multipart/form-data");

        var form = await Request.ReadFormAsync();
        var uploaded = new List<string>();

        foreach (var file in form.Files)
        {
            var safeName = Path.GetFileName(file.FileName);
            var dest = Path.Combine(_uploadPath, safeName);
            await using var stream = System.IO.File.Create(dest);
            await file.CopyToAsync(stream);
            uploaded.Add(safeName);
        }

        return Ok(new { uploaded });
    }

    [HttpGet("download/{fileName}")]
    public IActionResult Download(string fileName)
    {
        var safeName = Path.GetFileName(fileName);
        var filePath = Path.Combine(_uploadPath, safeName);

        if (!System.IO.File.Exists(filePath))
            return NotFound();

        return PhysicalFile(filePath, "application/octet-stream", safeName);
    }

    [HttpDelete("{fileName}")]
    public IActionResult Delete(string fileName)
    {
        var safeName = Path.GetFileName(fileName);
        var filePath = Path.Combine(_uploadPath, safeName);

        if (!System.IO.File.Exists(filePath))
            return NotFound();

        System.IO.File.Delete(filePath);
        return NoContent();
    }
}
